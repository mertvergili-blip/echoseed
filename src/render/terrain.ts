/**
 * Procedural terrain generation for the terrarium world.
 *
 * Turns the empty dark canvas into a naturalistic, layered habitat: deep and
 * shallow water, shorelines, wetland, grassland, forest, and rock, blended
 * organically (no flat colour blocks) with a soft top-left hillshade for a
 * sense of elevation and slope. Everything is derived deterministically from
 * the world seed, so the same seed always paints the same world — matching
 * the simulation's own determinism guarantee.
 *
 * The result is painted once into an offscreen canvas (used as a PixiJS
 * background texture) plus a list of vegetation/rock "stamps" and animated
 * water-shimmer points the renderer layers on top. This keeps per-frame cost
 * near zero: the expensive noise work happens exactly once per seed (cached),
 * not every frame.
 */

export interface TerrainStamp {
  x: number;
  y: number;
  r: number;
  kind: "tree" | "shrub" | "reed" | "rock";
  shade: number; // 0..1 darkness variation
}

export interface WaterPoint {
  x: number;
  y: number;
  phase: number;
  size: number;
}

export interface Terrain {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  seaLevel: number;
  stamps: TerrainStamp[];
  water: WaterPoint[];
  /** Sampleable fields (coarse grid) for gameplay/water masking later. */
  elevationAt(x: number, y: number): number;
  isWater(x: number, y: number): boolean;
}

// ---- deterministic value noise -------------------------------------------

function seedToInt(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function ihash(x: number, y: number, seed: number): number {
  let n = (Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca6b) ^ seed) >>> 0;
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 0x297a2d39) >>> 0;
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function vnoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  const n00 = ihash(x0, y0, seed);
  const n10 = ihash(x0 + 1, y0, seed);
  const n01 = ihash(x0, y0 + 1, seed);
  const n11 = ihash(x0 + 1, y0 + 1, seed);
  const nx0 = n00 + (n10 - n00) * fx;
  const nx1 = n01 + (n11 - n01) * fx;
  return nx0 + (nx1 - nx0) * fy;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ---- colour helpers -------------------------------------------------------

type RGB = [number, number, number];

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Muted, nocturnal-naturalistic palette: real biome identity, but dark enough
// that the bioluminescent organisms still read on top without competing neon.
const C_DEEP: RGB = [9, 24, 40];
const C_SHALLOW: RGB = [21, 57, 82];
const C_WETSAND: RGB = [42, 55, 60];
const C_BEACH: RGB = [64, 68, 52];
const C_GRASS_DRY: RGB = [52, 60, 40];
const C_GRASS: RGB = [33, 58, 40];
const C_GRASS_WET: RGB = [26, 54, 42];
const C_FOREST: RGB = [20, 45, 29];
const C_ROCK_LOW: RGB = [50, 52, 58];
const C_ROCK: RGB = [66, 68, 74];
const C_SNOW: RGB = [120, 126, 134];

function biomeColor(e: number, m: number, sea: number): RGB {
  if (e < sea) {
    // Water: deep -> shallow as we approach the shoreline.
    const t = smoothstep(Math.max(0, Math.min(1, (e - (sea - 0.22)) / 0.22)));
    return mix(C_DEEP, C_SHALLOW, t);
  }
  const land = (e - sea) / (1 - sea); // 0 at shore .. 1 at peak
  if (land < 0.05) {
    return mix(C_WETSAND, C_BEACH, smoothstep(land / 0.05));
  }
  if (land < 0.14) {
    // beach -> grass, moisture picks wet vs dry grass
    const base = m > 0.55 ? C_GRASS_WET : m < 0.3 ? C_GRASS_DRY : C_GRASS;
    return mix(C_BEACH, base, smoothstep((land - 0.05) / 0.09));
  }
  if (land < 0.5) {
    // grassland, blending to forest where moisture is high
    const grass = m > 0.55 ? C_GRASS_WET : m < 0.3 ? C_GRASS_DRY : C_GRASS;
    const forestT = smoothstep(Math.max(0, (m - 0.4) / 0.4)) * smoothstep((land - 0.14) / 0.36);
    return mix(grass, C_FOREST, forestT);
  }
  if (land < 0.72) {
    // forest / upland transition to rock
    const forest = m > 0.4 ? C_FOREST : C_GRASS_DRY;
    return mix(forest, C_ROCK_LOW, smoothstep((land - 0.5) / 0.22));
  }
  if (land < 0.9) {
    return mix(C_ROCK_LOW, C_ROCK, smoothstep((land - 0.72) / 0.18));
  }
  return mix(C_ROCK, C_SNOW, smoothstep((land - 0.9) / 0.1));
}

// ---- generation -----------------------------------------------------------

const cache = new Map<string, Terrain>();

export function generateTerrain(seed: string, worldW: number, worldH: number): Terrain {
  const key = `${seed}:${worldW}x${worldH}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const s = seedToInt(seed);
  const TW = 480;
  const TH = Math.round((TW * worldH) / worldW);
  const seaLevel = 0.4;

  // Coarse elevation/moisture grid (sampled up when painting) — cheaper than
  // full-res noise and gives smooth, organic fields.
  const GW = 160;
  const GH = Math.round((GW * worldH) / worldW);
  const elev = new Float32Array(GW * GH);
  const moist = new Float32Array(GW * GH);

  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const nx = (gx / GW) * 3.2;
      const ny = (gy / GH) * 3.2;
      // Domain warp for organic, non-blobby coastlines.
      const wx = nx + fbm(nx + 5.2, ny + 1.3, s + 71, 2) * 0.8;
      const wy = ny + fbm(nx + 9.7, ny + 4.1, s + 133, 2) * 0.8;
      let e = fbm(wx, wy, s, 5);
      // Gentle radial bias so edges tend toward water — makes the world read
      // as a contained island/habitat rather than terrain cut off by a frame.
      const cx = gx / GW - 0.5;
      const cy = gy / GH - 0.5;
      const d = Math.sqrt(cx * cx + cy * cy) / 0.707;
      e = e * (1 - 0.45 * smoothstep(Math.max(0, (d - 0.55) / 0.45)));
      elev[gy * GW + gx] = e;
      moist[gy * GW + gx] = fbm(nx + 21.5, ny + 33.9, s + 999, 3);
    }
  }

  const sampleGrid = (arr: Float32Array, u: number, v: number): number => {
    const fx = Math.max(0, Math.min(GW - 1.001, u * (GW - 1)));
    const fy = Math.max(0, Math.min(GH - 1.001, v * (GH - 1)));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const a = arr[y0 * GW + x0];
    const b = arr[y0 * GW + x0 + 1];
    const c = arr[(y0 + 1) * GW + x0];
    const dd = arr[(y0 + 1) * GW + x0 + 1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (dd - c) * tx) * ty;
  };

  const canvas = document.createElement("canvas");
  canvas.width = TW;
  canvas.height = TH;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(TW, TH);
  const data = img.data;

  for (let py = 0; py < TH; py++) {
    for (let px = 0; px < TW; px++) {
      const u = px / (TW - 1);
      const v = py / (TH - 1);
      const e = sampleGrid(elev, u, v);
      const m = sampleGrid(moist, u, v);
      let col = biomeColor(e, m, seaLevel);

      if (e >= seaLevel) {
        // Hillshade from the elevation gradient (light from top-left).
        const eR = sampleGrid(elev, Math.min(1, u + 1 / GW), v);
        const eD = sampleGrid(elev, u, Math.min(1, v + 1 / GH));
        const slopeX = (eR - e) * GW;
        const slopeY = (eD - e) * GH;
        const light = Math.max(0.72, Math.min(1.22, 1 - (slopeX + slopeY) * 0.9));
        col = [col[0] * light, col[1] * light, col[2] * light];
        // High-frequency ground texture variation.
        const grain = 0.92 + vnoise(px * 0.4, py * 0.4, s + 4242) * 0.16;
        col = [col[0] * grain, col[1] * grain, col[2] * grain];
      } else {
        // Water depth shading + faint value variation.
        const grain = 0.95 + vnoise(px * 0.25, py * 0.25, s + 8080) * 0.1;
        col = [col[0] * grain, col[1] * grain, col[2] * grain];
      }

      const o = (py * TW + px) * 4;
      data[o] = Math.max(0, Math.min(255, col[0]));
      data[o + 1] = Math.max(0, Math.min(255, col[1]));
      data[o + 2] = Math.max(0, Math.min(255, col[2]));
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Scatter vegetation/rock stamps deterministically, placed by biome so
  // forests read as forests and rocky ground reads as rocky from far zoom.
  const stamps: TerrainStamp[] = [];
  const water: WaterPoint[] = [];
  let rngState = (s ^ 0x1234567) >>> 0;
  const rnd = () => {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 4294967296;
  };
  const cellPx = worldW / GW;
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const e = elev[gy * GW + gx];
      const m = moist[gy * GW + gx];
      const wx = (gx + 0.5) * cellPx;
      const wy = (gy + 0.5) * (worldH / GH);
      const land = (e - seaLevel) / (1 - seaLevel);
      if (e < seaLevel) {
        // Water shimmer points, sparse.
        if (e < seaLevel - 0.03 && rnd() < 0.05) {
          water.push({ x: wx, y: wy, phase: rnd() * Math.PI * 2, size: 4 + rnd() * 7 });
        }
        continue;
      }
      if (land > 0.14 && land < 0.62 && m > 0.42 && rnd() < 0.42) {
        // forest canopy cluster
        const n = 1 + Math.floor(rnd() * 2);
        for (let i = 0; i < n; i++) {
          stamps.push({
            x: wx + (rnd() - 0.5) * cellPx * 1.4,
            y: wy + (rnd() - 0.5) * cellPx * 1.4,
            r: 7 + rnd() * 9,
            kind: "tree",
            shade: rnd(),
          });
        }
      } else if (land > 0.05 && land < 0.3 && m > 0.3 && rnd() < 0.14) {
        stamps.push({ x: wx, y: wy, r: 3 + rnd() * 3, kind: "shrub", shade: rnd() });
      } else if (land >= 0 && land < 0.06 && rnd() < 0.16) {
        stamps.push({ x: wx, y: wy, r: 3 + rnd() * 4, kind: "reed", shade: rnd() });
      } else if (land > 0.62 && rnd() < 0.2) {
        stamps.push({ x: wx, y: wy, r: 3 + rnd() * 6, kind: "rock", shade: rnd() });
      }
    }
  }

  // Paint vegetation/rock directly INTO the terrain texture (back-to-front by
  // y for correct overlap) rather than as live PixiJS geometry. Trees don't
  // move, so making them part of the single background quad keeps the scene a
  // trivial one-sprite draw — a live Graphics of several thousand stamps
  // rasterized every frame made the software renderer janky enough to stall
  // even UI clicks.
  const tScale = TW / worldW;
  stamps.sort((a, b) => a.y - b.y);
  for (const st of stamps) paintStamp(ctx, st, tScale);

  const terrain: Terrain = {
    canvas,
    width: worldW,
    height: worldH,
    seaLevel,
    stamps,
    water,
    elevationAt: (x, y) => sampleGrid(elev, x / worldW, y / worldH),
    isWater: (x, y) => sampleGrid(elev, x / worldW, y / worldH) < seaLevel,
  };
  cache.set(key, terrain);
  return terrain;
}

/** Paint one vegetation/rock stamp onto the terrain canvas (Canvas2D). World
 * coords are scaled to texture space by `sc`. Soft offset shadow + top-left
 * highlight give forests volume rather than flat dots. */
function paintStamp(ctx: CanvasRenderingContext2D, s: TerrainStamp, sc: number): void {
  const x = s.x * sc;
  const y = s.y * sc;
  const r = Math.max(1.2, s.r * sc);
  const disc = (cx: number, cy: number, rad: number, color: string) => {
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  };
  if (s.kind === "tree") {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x + r * 0.5, y + r * 0.7, r * 1.05, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(5,16,10,0.35)";
    ctx.fill();
    ctx.restore();
    const g = 46 + Math.round(s.shade * 12);
    disc(x, y, r, `rgb(19,${g},28)`);
    disc(x - r * 0.35, y - r * 0.35, r * 0.55, "rgba(36,81,47,0.9)");
    disc(x - r * 0.5, y - r * 0.5, r * 0.24, "rgba(56,107,64,0.7)");
  } else if (s.kind === "shrub") {
    disc(x + r * 0.3, y + r * 0.5, r * 0.8, "rgba(5,16,10,0.28)");
    disc(x, y, r, "rgba(28,61,36,0.92)");
    disc(x - r * 0.3, y - r * 0.3, r * 0.5, "rgba(44,86,54,0.7)");
  } else if (s.kind === "reed") {
    const n = 3 + Math.floor(s.shade * 3);
    ctx.strokeStyle = "rgba(47,74,44,0.8)";
    ctx.lineWidth = Math.max(0.6, r * 0.28);
    for (let i = 0; i < n; i++) {
      const ox = (i - n / 2) * 0.9;
      ctx.beginPath();
      ctx.moveTo(x + ox, y + r * 0.5);
      ctx.lineTo(x + ox + (s.shade - 0.5) * 1.2, y - r);
      ctx.stroke();
    }
  } else {
    disc(x + r * 0.4, y + r * 0.5, r * 0.9, "rgba(5,7,10,0.32)");
    disc(x, y, r, "rgba(60,63,71,0.95)");
    disc(x - r * 0.3, y - r * 0.3, r * 0.5, "rgba(86,91,102,0.65)");
  }
}
