import { Application, Container, Graphics, Sprite, Texture, Ticker } from "pixi.js";
import type { FrameData, RenderOrganism } from "../sim/protocol";
import { CONFIG } from "../sim/config";
import { generateTerrain, type Terrain } from "./terrain";
import { drawCreatureBody, locomotionFor } from "./creatureBody";
import { drawPlantForm, plantFormFor, type PlantForm } from "./plantForms";

/**
 * PixiJS renderer for the terrarium. Draws organisms procedurally from their
 * genome-derived visual traits. Interpolates positions between sim frames for
 * smoothness. Kept fully decoupled from the simulation (frame-data in only).
 */
export class TerrariumRenderer {
  app: Application;
  private world: Container;
  private terrainLayer: Container;
  private shadowLayer: Container;
  private glowLayer: Container;
  private bodyLayer: Container;
  private overlay: Container;
  private terrain: Terrain | null = null;
  private terrainSeed: string | null = null;
  private waterShimmer: Graphics | null = null;
  private shimmerTime = 0;
  private wakeFx: Graphics;
  private wakes: { x: number; y: number; life: number; max: number; size: number }[] = [];
  private sprites = new Map<number, OrganismSprite>();
  private lastFrame: FrameData | null = null;
  private prevPositions = new Map<number, { x: number; y: number }>();
  private frameTime = 0;
  private simFrameInterval = 33;
  private selectedId: number | null = null;
  private cameraFollowId: number | null = null;
  private camera = { x: 0, y: 0, zoom: 1 };
  private viewW = 0;
  private viewH = 0;
  private selectionRing: Graphics;
  private nightOverlay: Graphics;
  private fpsSamples: number[] = [];
  onFps: (fps: number) => void = () => {};
  onPick: (id: number | null) => void = () => {};

  private ready = false;
  // Set when destroy() is called before init() has finished resolving.
  // Application.init() is async, so a caller that mounts and immediately
  // unmounts (React 18 StrictMode's dev-mode double-invoke does exactly
  // this on every mount, and any fast real-world remount could too) can
  // call destroy() while this.app.ticker/this.app.destroy don't exist yet
  // to operate on — that used to throw "Cannot read properties of
  // undefined (reading 'remove')" and crash the app. Now destroy() just
  // records the request, and init() checks it the moment the underlying
  // Pixi Application is actually ready to be torn down, instead of half
  // finishing setup on a renderer nobody wants anymore (which would leak a
  // live ticker + WebGL context attached to an unmounted canvas).
  private destroyRequested = false;

  constructor() {
    this.app = new Application();
    this.world = new Container();
    this.terrainLayer = new Container();
    this.wakeFx = new Graphics();
    this.shadowLayer = new Container();
    this.glowLayer = new Container();
    this.bodyLayer = new Container();
    this.overlay = new Container();
    this.selectionRing = new Graphics();
    this.nightOverlay = new Graphics();
  }

  async init(canvas: HTMLCanvasElement, container: HTMLElement) {
    await this.app.init({
      canvas,
      resizeTo: container,
      antialias: true,
      backgroundAlpha: 0,
      preference: "webgl",
      powerPreference: "high-performance",
    });

    if (this.destroyRequested) {
      // Torn down before we finished starting up: app.init() has resolved
      // now, so it's safe to destroy, and there's no point building out the
      // rest of the scene graph for a renderer that's already unmounted.
      this.app.destroy(true);
      return;
    }

    this.viewW = this.app.screen.width;
    this.viewH = this.app.screen.height;

    // Layer order (bottom -> top): terrain, glow, bodies, selection.
    // No BlurFilter on the glow layer: a full-layer software blur pass every
    // frame (over one soft circle per organism) was the single biggest GPU
    // cost under the CPU/swiftshader renderer used in CI and on machines
    // without a GPU. The soft glow is instead faked with a few concentric
    // translucent circles per organism (see drawGlowShadow) — cheaper, and it
    // also keeps the glow subtler, which suits the naturalistic art direction.
    this.world.addChild(this.terrainLayer);
    this.world.addChild(this.wakeFx); // ripples on the water surface, under creatures
    this.world.addChild(this.shadowLayer);
    this.world.addChild(this.glowLayer);
    this.world.addChild(this.bodyLayer);
    this.world.addChild(this.selectionRing);
    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.nightOverlay);
    this.app.stage.addChild(this.overlay);

    this.drawBackground();
    this.centerCamera();

    this.app.ticker.add(this.renderTick);
    this.ready = true;
  }

  private drawBackground() {
    // Dark base fill shown until terrain is generated (and behind the water
    // edges). A thin border frames the world bounds.
    const bg = new Graphics();
    bg.rect(0, 0, CONFIG.worldWidth, CONFIG.worldHeight).fill({ color: 0x060a10, alpha: 1 });
    bg.rect(0, 0, CONFIG.worldWidth, CONFIG.worldHeight).stroke({
      color: 0x14283c,
      width: 2,
      alpha: 0.7,
    });
    this.terrainLayer.addChildAt(bg, 0);
  }

  /**
   * Generate and paint the procedural habitat for a given world seed. Called
   * from the app once the seed is known; idempotent per seed so the render
   * loop / StrictMode double-invoke won't rebuild it repeatedly.
   */
  buildTerrain(seed: string) {
    if (!this.ready || this.terrainSeed === seed) return;
    this.terrainSeed = seed;
    // Clear any previous terrain (e.g. after Reset with a new seed), keeping
    // the dark base fill at index 0.
    while (this.terrainLayer.children.length > 1) {
      const c = this.terrainLayer.children[this.terrainLayer.children.length - 1];
      this.terrainLayer.removeChild(c);
      c.destroy({ children: true });
    }
    this.waterShimmer = null;

    const t = generateTerrain(seed, CONFIG.worldWidth, CONFIG.worldHeight);
    this.terrain = t;

    // The terrain texture already includes baked vegetation/rock, so the
    // whole habitat is a single sprite — cheap to draw every frame.
    const bg = new Sprite(Texture.from(t.canvas));
    bg.width = CONFIG.worldWidth;
    bg.height = CONFIG.worldHeight;
    this.terrainLayer.addChild(bg);

    // Animated water shimmer (updated each frame in renderTick).
    this.waterShimmer = new Graphics();
    this.terrainLayer.addChild(this.waterShimmer);
  }

  /** Minimum zoom at which the world still fully covers the viewport on both
   * axes (cover-fit, not letterboxed fit). Used as the default zoom and the
   * zoom-out clamp so the habitat always fills the screen — there are never
   * black bands above/below or beside the world. */
  private coverZoom(): number {
    return Math.max(this.viewW / CONFIG.worldWidth, this.viewH / CONFIG.worldHeight);
  }

  private centerCamera() {
    this.camera.zoom = this.coverZoom();
    this.camera.x = CONFIG.worldWidth / 2;
    this.camera.y = CONFIG.worldHeight / 2;
  }

  /** Keep the camera within world bounds so the viewport never shows past the
   * world edge (which would reveal black). With cover-fit min zoom the world
   * is always at least as large as the viewport, so the clamp range is valid. */
  private clampCamera() {
    const z = this.camera.zoom;
    const halfW = this.viewW / (2 * z);
    const halfH = this.viewH / (2 * z);
    this.camera.x = Math.max(halfW, Math.min(CONFIG.worldWidth - halfW, this.camera.x));
    this.camera.y = Math.max(halfH, Math.min(CONFIG.worldHeight - halfH, this.camera.y));
  }

  resize() {
    if (!this.ready) return;
    this.viewW = this.app.screen.width;
    this.viewH = this.app.screen.height;
    // Never let a resize leave us zoomed out past full coverage.
    this.camera.zoom = Math.max(this.camera.zoom, this.coverZoom());
    this.clampCamera();
  }

  setFrame(frame: FrameData) {
    // Store previous positions for interpolation.
    if (this.lastFrame) {
      for (const o of this.lastFrame.organisms) {
        this.prevPositions.set(o.id, { x: o.x, y: o.y });
      }
    }
    this.lastFrame = frame;
    this.frameTime = 0;
    this.syncSprites(frame);
    this.updateNight(frame.env.timeOfDay, frame.env.weather);
  }

  private syncSprites(frame: FrameData) {
    const seen = new Set<number>();
    for (const o of frame.organisms) {
      seen.add(o.id);
      let sprite = this.sprites.get(o.id);
      if (!sprite) {
        sprite = new OrganismSprite(o);
        this.sprites.set(o.id, sprite);
        this.shadowLayer.addChild(sprite.shadow);
        this.glowLayer.addChild(sprite.glow);
        this.bodyLayer.addChild(sprite.body);
      }
      sprite.updateData(o);
    }
    // Remove sprites for organisms that died / left.
    for (const [id, sprite] of this.sprites) {
      if (!seen.has(id)) {
        sprite.destroy();
        this.sprites.delete(id);
        this.prevPositions.delete(id);
        if (this.selectedId === id) {
          this.selectedId = null;
          this.onPick(null);
        }
      }
    }
  }

  private updateNight(timeOfDay: number, weather: string) {
    // Atmospheric day/night wash: cool-dark at night, warm at dawn/dusk,
    // near-clear at noon, tinted by weather. Plus a soft vignette always, so
    // the habitat reads as a lit scene rather than a flat sprite sheet.
    const daylight = Math.max(0, Math.sin(timeOfDay * Math.PI)); // 0 at night edges
    // Dawn ~0.25, dusk ~0.75: a golden-hour band where the sun is low.
    const goldenDawn = Math.max(0, 1 - Math.abs(timeOfDay - 0.25) / 0.12);
    const goldenDusk = Math.max(0, 1 - Math.abs(timeOfDay - 0.78) / 0.12);
    const golden = Math.max(goldenDawn, goldenDusk);

    let tint = 0x02060f; // night: deep cool blue
    let darkness = (1 - daylight) * 0.62;
    if (golden > 0.05 && daylight > 0.02) {
      tint = 0x2a160a; // warm amber wash at golden hour
      darkness = Math.max(darkness, golden * 0.32);
    }
    if (weather === "cold") tint = 0x0a1c30;
    else if (weather === "drought") tint = 0x241708;
    else if (weather === "rain") tint = 0x08131f;

    this.nightOverlay.clear();
    this.nightOverlay.rect(0, 0, this.viewW, this.viewH).fill({ color: tint, alpha: darkness });
  }

  /** Subtle, cheap water shimmer: a handful of soft specular glints on the
   * water surface, breathing in and out on their own phase. Dampened to
   * nothing under prefers-reduced-motion. */
  private shimmerAccum = 0;
  private animateWater(dtMs: number) {
    const g = this.waterShimmer;
    const t = this.terrain;
    if (!g || !t || MOTION_AMP === 0) return;
    this.shimmerTime += dtMs * 0.001;
    // The shimmer is decorative and low-frequency; rebuilding ~180 ellipses
    // every frame is wasted work on the software renderer. Refresh at ~20fps.
    this.shimmerAccum += dtMs;
    if (this.shimmerAccum < 50) return;
    this.shimmerAccum = 0;
    g.clear();
    for (const p of t.water) {
      const a = 0.06 + 0.12 * (0.5 + 0.5 * Math.sin(this.shimmerTime * 1.4 + p.phase));
      const sway = Math.sin(this.shimmerTime * 0.8 + p.phase) * 3;
      g.ellipse(p.x + sway, p.y, p.size, p.size * 0.4).fill({ color: 0x9fdfff, alpha: a });
    }
  }

  /** Expanding, fading ripple rings left behind swimmers — cheap pooled
   * effect that makes the water feel disturbed by life moving through it. */
  private drawWakes(dtMs: number) {
    const g = this.wakeFx;
    g.clear();
    const dt = dtMs * 0.001;
    for (let i = this.wakes.length - 1; i >= 0; i--) {
      const w = this.wakes[i];
      w.life += dt;
      if (w.life >= w.max) {
        this.wakes.splice(i, 1);
        continue;
      }
      const t = w.life / w.max;
      const rr = w.size * (0.4 + t * 1.6);
      g.ellipse(w.x, w.y, rr, rr * 0.5).stroke({
        color: 0xbfe8ff,
        width: 1.2,
        alpha: 0.28 * (1 - t),
      });
    }
  }

  private renderTick = (ticker: Ticker) => {
    this.frameTime += ticker.deltaMS;
    const t = Math.min(1, this.frameTime / this.simFrameInterval);

    this.animateWater(ticker.deltaMS);

    // Camera follow.
    if (this.cameraFollowId != null) {
      const s = this.sprites.get(this.cameraFollowId);
      if (s) {
        this.camera.x += (s.data.x - this.camera.x) * 0.08;
        this.camera.y += (s.data.y - this.camera.y) * 0.08;
        this.camera.zoom += (1.6 - this.camera.zoom) * 0.05;
      } else {
        this.cameraFollowId = null;
      }
    }

    // Keep the viewport inside the world every frame (covers follow drift,
    // resize, and any accumulated pan), so black never shows at the edges.
    this.clampCamera();

    // Apply camera transform to world container.
    const z = this.camera.zoom;
    this.world.scale.set(z);
    this.world.position.set(
      this.viewW / 2 - this.camera.x * z,
      this.viewH / 2 - this.camera.y * z,
    );

    // Update sprite positions (interpolated) and animation. Off-screen
    // sprites are hidden and skipped (culling), and full per-limb animation
    // only runs when zoomed in enough to see it (LOD) — so the cost of the
    // animated bodies stays bounded regardless of total population.
    const near = z >= 1.15;
    const margin = 80;
    const nowMs = performance.now();
    for (const [id, sprite] of this.sprites) {
      const prev = this.prevPositions.get(id);
      let x = sprite.data.x;
      let y = sprite.data.y;
      if (prev) {
        x = prev.x + (sprite.data.x - prev.x) * t;
        y = prev.y + (sprite.data.y - prev.y) * t;
      }
      const sx = x * z + (this.viewW / 2 - this.camera.x * z);
      const sy = y * z + (this.viewH / 2 - this.camera.y * z);
      const onScreen = sx > -margin && sx < this.viewW + margin && sy > -margin && sy < this.viewH + margin;
      sprite.setVisible(onScreen);
      if (!onScreen) continue;
      if (this.terrain && nowMs - sprite.envSampleTime > 200) {
        sprite.cachedInWater = this.terrain.isWater(x, y);
        sprite.cachedElev = this.terrain.elevationAt(x, y);
        sprite.envSampleTime = nowMs;
      }
      const inWater = sprite.cachedInWater;
      sprite.render(x, y, ticker.deltaMS, inWater, near ? 1 : 0, sprite.cachedElev);

      // Swimmers leave a fading wake ripple on the water surface. Only when
      // zoomed in enough to actually see them (they're sub-pixel at far zoom),
      // which also keeps the effect off the cheap far-zoom render path.
      if (near && inWater && sprite.data.species !== 0 && MOTION_AMP > 0) {
        const spd = Math.hypot(sprite.data.vx, sprite.data.vy);
        if (spd > 0.4 && this.wakes.length < 120 && Math.random() < 0.25) {
          const radius = 5 + sprite.data.size * 7;
          this.wakes.push({ x, y, life: 0, max: 0.9, size: radius * 0.6 });
        }
      }
    }
    if (near || this.wakes.length) this.drawWakes(ticker.deltaMS);

    // Selection ring.
    this.selectionRing.clear();
    if (this.selectedId != null) {
      const s = this.sprites.get(this.selectedId);
      if (s) {
        const r = 14 + s.data.size * 10;
        this.selectionRing
          .circle(s.renderX, s.renderY, r)
          .stroke({ color: 0x8be9fd, width: 2, alpha: 0.9 });
        this.selectionRing
          .circle(s.renderX, s.renderY, r + 4)
          .stroke({ color: 0x8be9fd, width: 1, alpha: 0.3 });
      }
    }

    // FPS.
    const fps = ticker.FPS;
    this.fpsSamples.push(fps);
    if (this.fpsSamples.length > 30) this.fpsSamples.shift();
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.onFps(Math.round(avg));
  };

  /** Screen coords -> world coords, for click picking. */
  private screenToWorld(sx: number, sy: number) {
    const z = this.camera.zoom;
    return {
      x: (sx - (this.viewW / 2 - this.camera.x * z)) / z,
      y: (sy - (this.viewH / 2 - this.camera.y * z)) / z,
    };
  }

  pick(screenX: number, screenY: number) {
    const w = this.screenToWorld(screenX, screenY);
    let best: number | null = null;
    let bestD = Infinity;
    for (const [id, s] of this.sprites) {
      const dx = s.data.x - w.x;
      const dy = s.data.y - w.y;
      const d = dx * dx + dy * dy;
      const r = 16 + s.data.size * 12;
      if (d < r * r && d < bestD) {
        bestD = d;
        best = id;
      }
    }
    this.selectedId = best;
    this.onPick(best);
    return best;
  }

  worldPointFromScreen(screenX: number, screenY: number) {
    return this.screenToWorld(screenX, screenY);
  }

  /** Whether a world point is over water — drives creature locomotion, and
   * exposed to the e2e/visual test hook so a test can pick a swimmer vs a
   * land-crawler deterministically. */
  isWaterAt(worldX: number, worldY: number): boolean {
    return this.terrain ? this.terrain.isWater(worldX, worldY) : false;
  }

  /** Inverse of worldPointFromScreen — used by the e2e test hook to click
   * an exact organism instead of scanning the canvas blindly (see
   * App.tsx's window.__echoseedTestHook). */
  screenPointFromWorld(worldX: number, worldY: number) {
    const z = this.camera.zoom;
    return {
      x: worldX * z + (this.viewW / 2 - this.camera.x * z),
      y: worldY * z + (this.viewH / 2 - this.camera.y * z),
    };
  }

  setSelected(id: number | null) {
    this.selectedId = id;
  }

  followSelected(follow: boolean) {
    this.cameraFollowId = follow ? this.selectedId : null;
    if (!follow) this.centerCamera();
  }

  panBy(dx: number, dy: number) {
    this.cameraFollowId = null;
    this.camera.x -= dx / this.camera.zoom;
    this.camera.y -= dy / this.camera.zoom;
  }

  zoomBy(factor: number, cx: number, cy: number) {
    const before = this.screenToWorld(cx, cy);
    // Lower bound is cover-fit, not an arbitrary 0.2 — zooming out can never
    // shrink the world smaller than the viewport.
    this.camera.zoom = Math.max(this.coverZoom(), Math.min(5, this.camera.zoom * factor));
    const after = this.screenToWorld(cx, cy);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
    this.clampCamera();
  }

  destroy() {
    if (!this.ready) {
      // init() is still in flight (or never started) — record the request
      // and let init() finish tearing itself down once app.init() resolves.
      this.destroyRequested = true;
      return;
    }
    this.app.ticker.remove(this.renderTick);
    this.app.destroy(true);
  }
}

// Decorative oscillation (glow pulse, idle sway/shimmer) is dampened to
// near-zero amplitude for users who've requested reduced motion at the OS
// level — the underlying values (energy/health-driven scale and alpha)
// still convey the same information, just without the animated wobble.
// This intentionally does not touch simulation logic (movement, behavior),
// only this renderer's cosmetic embellishment on top of it.
const REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const MOTION_AMP = REDUCED_MOTION ? 0 : 1;

/** A single procedurally-drawn organism. */
class OrganismSprite {
  glow: Graphics;
  body: Graphics;
  shadow: Graphics;
  data: RenderOrganism;
  renderX = 0;
  renderY = 0;
  private phase: number;
  private animPhase = 0;
  private prevHeading = 0;
  private turnSmoothed = 0;
  private lastKey = "";
  private lastLod = -1;
  private lastBodyDraw = -1;
  // Cached habitat sample (water/elevation) — refreshed a few times a second
  // in the render loop rather than every frame, since a creature crosses a
  // shoreline far slower than 60fps. Cuts terrain grid-sampling ~12x.
  cachedInWater = false;
  cachedElev = 0.5;
  envSampleTime = -1;
  private genomeKey = "";
  private keyHue = NaN;
  private keySize = NaN;
  private keyProp = NaN;

  constructor(data: RenderOrganism) {
    this.data = data;
    this.glow = new Graphics();
    this.body = new Graphics();
    this.shadow = new Graphics();
    this.phase = (data.id % 100) * 0.37;
    this.animPhase = (data.id % 100) * 0.31;
    this.prevHeading = Math.atan2(data.vy, data.vx);
  }

  updateData(data: RenderOrganism) {
    this.data = data;
  }

  setVisible(v: boolean) {
    this.body.visible = v;
    this.glow.visible = v;
    this.shadow.visible = v;
  }

  private hueToRgb(h: number, s: number, l: number): number {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return (
      (Math.round((r + m) * 255) << 16) |
      (Math.round((g + m) * 255) << 8) |
      Math.round((b + m) * 255)
    );
  }

  /** Draw the glow aura + ground shadow (redrawn only when the genome-visual
   * key changes, not every frame). */
  private drawGlowShadow() {
    const d = this.data;
    const color = this.hueToRgb(d.hue, 0.7, 0.62);
    const radius = 5 + d.size * 7;
    this.glow.clear();
    this.shadow.clear();
    if (d.species === 0) {
      // Plants: a wide flat ground shadow at the base, and only a whisper of
      // glow up in the foliage (no neon halo — plants aren't light sources).
      this.shadow.ellipse(0, 0, radius * 1.0, radius * 0.32).fill({ color: 0x03060a, alpha: 0.28 });
      this.glow.circle(0, -radius * 0.9, radius * 1.1).fill({ color, alpha: 0.06 });
    } else {
      this.shadow.ellipse(0, 0, radius * 1.25, radius * 0.4).fill({ color: 0x03060a, alpha: 0.3 });
      // Fake a soft glow with a few concentric translucent rings (no filter).
      this.glow.circle(0, 0, radius * 2.0).fill({ color, alpha: 0.08 });
      this.glow.circle(0, 0, radius * 1.5).fill({ color, alpha: 0.1 });
      this.glow.circle(0, 0, radius * 1.05).fill({ color, alpha: 0.12 });
    }
  }

  private plantForm: PlantForm = "shrub";

  /** Draw the plant at its chosen form (static; wind sway applied per-frame). */
  private drawPlant(motion: number) {
    this.body.clear();
    const growth = 0.55 + this.data.energyFrac * 0.45;
    drawPlantForm(this.body, this.data, this.plantForm, this.animPhase, motion, growth);
  }

  /**
   * @param inWater whether the organism is over water (drives swim vs crawl)
   * @param lod 1 = near (full per-frame limb animation), 0 = far (cached static pose)
   */
  render(x: number, y: number, dtMs: number, inWater: boolean, lod: number, elev: number) {
    this.renderX = x;
    this.renderY = y;
    this.phase += dtMs * 0.004;
    this.animPhase += dtMs * 0.001;
    const d = this.data;
    const radius = 5 + d.size * 7;

    let loco: string;
    if (d.species === 0) {
      const landHeight = Math.max(0, (elev - 0.4) / 0.6);
      this.plantForm = plantFormFor(d, inWater, landHeight);
      loco = this.plantForm; // form participates in the redraw key
    } else {
      loco = inWater ? "swim" : "crawl";
    }
    // The genome portion of the redraw key is constant over the organism's
    // life (only a rare in-place mutation changes it), so cache it behind a
    // cheap numeric guard instead of running toFixed() 200×/frame.
    if (d.hue !== this.keyHue || d.size !== this.keySize || d.proportion !== this.keyProp) {
      this.keyHue = d.hue;
      this.keySize = d.size;
      this.keyProp = d.proportion;
      this.genomeKey = `${Math.round(d.hue)}:${d.size.toFixed(2)}:${d.proportion.toFixed(2)}:${d.species}`;
    }
    const key = this.genomeKey + ":" + loco;
    const keyChanged = key !== this.lastKey;
    if (keyChanged) {
      this.drawGlowShadow();
      if (d.species === 0) this.drawPlant(lod >= 1 ? MOTION_AMP : 0);
      this.lastKey = key;
    }

    this.body.position.set(x, y);
    this.glow.position.set(x, y);
    // Plants are drawn base-at-origin growing upward, so their shadow sits at
    // the base (origin), not below the visual centre.
    this.shadow.position.set(x, d.species === 0 ? y + radius * 0.15 : y + radius * 0.5);

    if (d.species !== 0) {
      const rawSpeed = Math.hypot(d.vx, d.vy);
      const speed01 = Math.max(0, Math.min(1, rawSpeed / 2));
      let heading = this.prevHeading;
      if (rawSpeed > 0.02) heading = Math.atan2(d.vy, d.vx);
      // Smoothed signed turn rate feeds the body's curve-into-turns.
      let dh = heading - this.prevHeading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      this.turnSmoothed += (Math.max(-1, Math.min(1, dh * 12)) - this.turnSmoothed) * 0.25;
      this.prevHeading = heading;

      const near = lod >= 1;
      // Animate limb-level detail at ~30fps rather than every frame — the
      // difference is imperceptible but it roughly halves the redraw cost of
      // the multi-part bodies, which matters on the software renderer.
      if (near && (keyChanged || this.lastLod !== lod || this.animPhase - this.lastBodyDraw > 0.033)) {
        this.lastBodyDraw = this.animPhase;
        this.body.clear();
        drawCreatureBody(this.body, d, locomotionFor(inWater), {
          phase: this.animPhase,
          speed: speed01,
          turn: this.turnSmoothed,
          action: d.action,
          lod,
          motion: MOTION_AMP,
        });
      } else if (!near && (keyChanged || this.lastLod !== lod)) {
        // Far LOD: cheap static pose, redrawn only on change.
        this.body.clear();
        drawCreatureBody(this.body, d, locomotionFor(inWater), {
          phase: this.animPhase,
          speed: 0,
          turn: 0,
          action: d.action,
          lod,
          motion: 0,
        });
      }
      this.lastLod = lod;

      this.body.rotation = heading;
      this.body.scale.set(1, Math.cos(heading) < 0 ? -1 : 1);

      const pulse = 0.85 + Math.sin(this.phase) * 0.12 * MOTION_AMP;
      const energyScale = 0.6 + d.energyFrac * 0.6;
      this.glow.scale.set(pulse * energyScale);
      this.shadow.scale.set(1);
    } else {
      // Plant: gentle wind lean via a small shear anchored at the base (the
      // plant is drawn growing up from origin). When zoomed in, redraw the
      // form each frame so leaves/blades actually sway rather than the whole
      // sprite skewing rigidly.
      this.body.rotation = 0;
      this.body.scale.set(1, 1);
      if (lod >= 1 && MOTION_AMP > 0) {
        // Redraw the swaying foliage at ~30fps, same as animal bodies.
        if (this.animPhase - this.lastBodyDraw > 0.033) {
          this.lastBodyDraw = this.animPhase;
          this.drawPlant(MOTION_AMP);
        }
        this.body.skew.set(Math.sin(this.phase * 0.9 + d.id) * 0.03, 0);
      } else {
        this.body.skew.set(0, 0);
      }
    }

    if (d.ascended) {
      this.glow.alpha = 0.9 + Math.sin(this.phase * 2) * 0.1 * MOTION_AMP;
      this.glow.scale.set(1.6 + Math.sin(this.phase * 3) * 0.2 * MOTION_AMP);
    } else {
      this.glow.alpha = 0.5 + d.healthFrac * 0.4;
    }
  }

  destroy() {
    this.glow.destroy();
    this.body.destroy();
    this.shadow.destroy();
  }
}
