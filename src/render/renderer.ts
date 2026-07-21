import { Application, Container, Graphics, Sprite, Texture, Ticker, BlurFilter } from "pixi.js";
import type { FrameData, RenderOrganism } from "../sim/protocol";
import { CONFIG } from "../sim/config";
import { generateTerrain, type Terrain } from "./terrain";

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

    // Layer order (bottom -> top): terrain, glow (blurred), bodies, selection.
    const blur = new BlurFilter({ strength: 8, quality: 3 });
    this.glowLayer.filters = [blur];
    this.world.addChild(this.terrainLayer);
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

  private centerCamera() {
    this.camera.zoom = Math.min(
      this.viewW / CONFIG.worldWidth,
      this.viewH / CONFIG.worldHeight,
    );
    this.camera.x = CONFIG.worldWidth / 2;
    this.camera.y = CONFIG.worldHeight / 2;
  }

  resize() {
    if (!this.ready) return;
    this.viewW = this.app.screen.width;
    this.viewH = this.app.screen.height;
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
  private animateWater(dtMs: number) {
    const g = this.waterShimmer;
    const t = this.terrain;
    if (!g || !t || MOTION_AMP === 0) return;
    this.shimmerTime += dtMs * 0.001;
    g.clear();
    for (const p of t.water) {
      const a = 0.06 + 0.12 * (0.5 + 0.5 * Math.sin(this.shimmerTime * 1.4 + p.phase));
      const sway = Math.sin(this.shimmerTime * 0.8 + p.phase) * 3;
      g.ellipse(p.x + sway, p.y, p.size, p.size * 0.4).fill({ color: 0x9fdfff, alpha: a });
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

    // Apply camera transform to world container.
    const z = this.camera.zoom;
    this.world.scale.set(z);
    this.world.position.set(
      this.viewW / 2 - this.camera.x * z,
      this.viewH / 2 - this.camera.y * z,
    );

    // Update sprite positions (interpolated) and animation.
    for (const [id, sprite] of this.sprites) {
      const prev = this.prevPositions.get(id);
      let x = sprite.data.x;
      let y = sprite.data.y;
      if (prev) {
        x = prev.x + (sprite.data.x - prev.x) * t;
        y = prev.y + (sprite.data.y - prev.y) * t;
      }
      sprite.render(x, y, ticker.deltaMS);
    }

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
    this.camera.zoom = Math.max(0.2, Math.min(4, this.camera.zoom * factor));
    const after = this.screenToWorld(cx, cy);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
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
  private lastRedrawKey = "";

  constructor(data: RenderOrganism) {
    this.data = data;
    this.glow = new Graphics();
    this.body = new Graphics();
    this.shadow = new Graphics();
    this.phase = (data.id % 100) * 0.37;
    this.redraw();
  }

  updateData(data: RenderOrganism) {
    this.data = data;
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

  private redraw() {
    const d = this.data;
    const color = this.hueToRgb(d.hue, 0.7, 0.62);
    const dark = this.hueToRgb(d.hue, 0.85, 0.32);
    const light = this.hueToRgb(d.hue, 0.6, 0.78);
    const radius = 5 + d.size * 7;
    this.body.clear();
    this.glow.clear();
    this.shadow.clear();

    // Soft contact shadow (drawn unrotated in shadowLayer) grounds the
    // organism on the terrain so it doesn't read as a floating sticker.
    const shR = radius * (d.species === 0 ? 0.9 : 1.15);
    this.shadow.ellipse(0, 0, shR, shR * 0.42).fill({ color: 0x03060a, alpha: 0.32 });

    if (d.species === 0) {
      // Plant: layered foliage rosette with a seed core.
      const blades = 5 + Math.floor(d.proportion * 4);
      for (let ring = 0; ring < 2; ring++) {
        const len = radius * (1.0 + d.proportion * 0.9) * (ring === 0 ? 1 : 0.6);
        const rot = ring * 0.4;
        for (let i = 0; i < blades; i++) {
          const a = (i / blades) * Math.PI * 2 + rot;
          this.body
            .moveTo(0, 0)
            .quadraticCurveTo(
              Math.cos(a - 0.15) * len * 0.5,
              Math.sin(a - 0.15) * len * 0.5,
              Math.cos(a) * len * 0.42,
              Math.sin(a) * len,
            )
            .stroke({ color: ring === 0 ? dark : color, width: 2, alpha: 0.85 });
        }
      }
      this.body.circle(0, 0, radius * 0.55).fill({ color: dark, alpha: 0.95 });
      this.body.circle(-radius * 0.12, -radius * 0.12, radius * 0.3).fill({ color: light, alpha: 0.9 });
      this.glow.circle(0, 0, radius * 1.5).fill({ color, alpha: 0.16 });
    } else if (d.species === 1) {
      // Herbivore: streamlined body with a distinct head, paired fins/legs,
      // and a tapering tail — reads as a small foraging animal, not a blob.
      const bodyLen = radius * 1.5;
      // fins/legs (behind body)
      const limbs = 2 + Math.floor(d.proportion * 2);
      for (let i = 0; i < limbs; i++) {
        const along = -bodyLen * 0.3 - i * radius * 0.5;
        for (const side of [-1, 1]) {
          this.body
            .moveTo(along, side * radius * 0.5)
            .quadraticCurveTo(along - radius * 0.4, side * radius * 1.1, along - radius * 0.7, side * radius * 0.9)
            .stroke({ color: dark, width: 2, alpha: 0.75 });
        }
      }
      // tail
      this.body
        .moveTo(-bodyLen * 0.7, 0)
        .lineTo(-bodyLen * 1.15, -radius * 0.4)
        .lineTo(-bodyLen * 1.15, radius * 0.4)
        .fill({ color: dark, alpha: 0.85 });
      // main body
      this.body.ellipse(0, 0, bodyLen, radius * 0.85).fill({ color: dark, alpha: 0.96 });
      this.body.ellipse(radius * 0.1, -radius * 0.15, bodyLen * 0.7, radius * 0.5).fill({ color, alpha: 0.9 });
      // head
      this.body.circle(bodyLen * 0.72, 0, radius * 0.62).fill({ color, alpha: 0.95 });
      this.body.circle(bodyLen * 0.62, -radius * 0.18, radius * 0.28).fill({ color: light, alpha: 0.7 });
      // eye
      this.body.circle(bodyLen * 0.85, -radius * 0.12, radius * 0.16).fill({ color: 0x05100a, alpha: 0.9 });
      this.body.circle(bodyLen * 0.88, -radius * 0.16, radius * 0.06).fill({ color: 0xffffff, alpha: 0.9 });
      this.glow.circle(0, 0, radius * 1.9).fill({ color, alpha: 0.2 });
    } else {
      // Predator: sleek hunter with a pointed jaw, dorsal spines, and a
      // powerful tail — an unmistakably different silhouette from prey.
      const bodyLen = radius * 1.7;
      // dorsal spines
      const spikes = 3 + Math.floor(d.proportion * 3);
      for (let i = 0; i < spikes; i++) {
        const along = bodyLen * 0.3 - (i / spikes) * bodyLen * 1.1;
        this.body
          .moveTo(along, -radius * 0.4)
          .lineTo(along + radius * 0.2, -radius * 1.15)
          .lineTo(along + radius * 0.45, -radius * 0.4)
          .fill({ color: dark, alpha: 0.9 });
      }
      // tail
      this.body
        .moveTo(-bodyLen * 0.75, 0)
        .quadraticCurveTo(-bodyLen * 1.2, -radius * 0.7, -bodyLen * 1.3, -radius * 0.2)
        .quadraticCurveTo(-bodyLen * 1.1, 0, -bodyLen * 1.3, radius * 0.2)
        .quadraticCurveTo(-bodyLen * 1.2, radius * 0.7, -bodyLen * 0.75, 0)
        .fill({ color: dark, alpha: 0.9 });
      // body
      this.body
        .moveTo(bodyLen * 1.05, 0)
        .quadraticCurveTo(bodyLen * 0.3, -radius, -bodyLen * 0.75, 0)
        .quadraticCurveTo(bodyLen * 0.3, radius, bodyLen * 1.05, 0)
        .fill({ color: dark, alpha: 0.96 });
      this.body
        .moveTo(bodyLen * 0.9, 0)
        .quadraticCurveTo(bodyLen * 0.2, -radius * 0.55, -bodyLen * 0.4, 0)
        .quadraticCurveTo(bodyLen * 0.2, radius * 0.55, bodyLen * 0.9, 0)
        .fill({ color, alpha: 0.85 });
      // jaw + eye
      this.body
        .moveTo(bodyLen * 1.05, 0)
        .lineTo(bodyLen * 0.7, -radius * 0.28)
        .lineTo(bodyLen * 0.7, radius * 0.28)
        .fill({ color: light, alpha: 0.5 });
      this.body.circle(bodyLen * 0.6, -radius * 0.22, radius * 0.16).fill({ color: 0xffe0e0, alpha: 0.95 });
      this.body.circle(bodyLen * 0.6, -radius * 0.22, radius * 0.07).fill({ color: 0x300000, alpha: 0.95 });
      this.glow.circle(0, 0, radius * 2.1).fill({ color, alpha: 0.24 });
    }
    this.lastRedrawKey = `${Math.round(d.hue)}:${d.size.toFixed(2)}:${d.species}:${d.proportion.toFixed(2)}`;
  }

  render(x: number, y: number, dtMs: number) {
    this.renderX = x;
    this.renderY = y;
    this.phase += dtMs * 0.004;

    // Redraw only if genome-visual key changed (rare).
    const key = `${Math.round(this.data.hue)}:${this.data.size.toFixed(2)}:${this.data.species}:${this.data.proportion.toFixed(2)}`;
    if (key !== this.lastRedrawKey) this.redraw();

    const radius = 5 + this.data.size * 7;
    this.body.position.set(x, y);
    this.glow.position.set(x, y);
    // Shadow sits slightly below the body and never rotates, so motion reads
    // as the creature moving over the ground rather than the ground with it.
    this.shadow.position.set(x, y + radius * 0.5);

    // Rotate toward velocity for mobile creatures.
    if (this.data.species !== 0) {
      const speed = Math.hypot(this.data.vx, this.data.vy);
      if (speed > 0.05) {
        const targetRot = Math.atan2(this.data.vy, this.data.vx);
        this.body.rotation = targetRot;
        // Keep the creature upright (belly-down) rather than flipping upside
        // down when it swims/walks leftward.
        this.body.scale.y = Math.cos(targetRot) < 0 ? -1 : 1;
      }
      // Gentle "swim/step" bob perpendicular to travel + glow breathing.
      const gait = Math.sin(this.phase * 3) * 0.06 * MOTION_AMP;
      this.body.scale.x = 1 + gait;
      const pulse = 0.85 + Math.sin(this.phase) * 0.12 * MOTION_AMP;
      const energyScale = 0.6 + this.data.energyFrac * 0.6;
      this.glow.scale.set(pulse * energyScale);
      // Shadow shrinks a touch on the up-beat of the gait for liveliness.
      this.shadow.scale.set(1 - Math.abs(gait) * 0.8);
    } else {
      const sway = 1 + Math.sin(this.phase) * 0.05 * MOTION_AMP;
      this.body.scale.set(sway);
    }

    // Ascended creatures shimmer brighter.
    if (this.data.ascended) {
      this.glow.alpha = 0.9 + Math.sin(this.phase * 2) * 0.1 * MOTION_AMP;
      this.glow.scale.set(1.6 + Math.sin(this.phase * 3) * 0.2 * MOTION_AMP);
    } else {
      this.glow.alpha = 0.5 + this.data.healthFrac * 0.4;
    }
  }

  destroy() {
    this.glow.destroy();
    this.body.destroy();
    this.shadow.destroy();
  }
}
