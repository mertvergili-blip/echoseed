import { Graphics } from "pixi.js";
import type { RenderOrganism } from "../sim/protocol";

/**
 * Procedural, multi-part, animated creature bodies.
 *
 * The same simulation produces three genuinely different morphologies driven
 * by species + environment, not just colour:
 *   - aquatic herbivore  (rounded body, big eye, dorsal+pectoral+tail fins,
 *                          gentle full-body undulation)
 *   - aquatic predator   (elongated streamlined body, jaw, swept tail, dorsal
 *                          spine, faster tail beat, lunge pose when hunting)
 *   - shoreline crawler  (segmented body on legs that plant on the ground with
 *                          a walk cycle) — used when an animal is over land
 *
 * Bodies are assembled from separate parts (spine, head, jaw, eyes, fins/legs,
 * tail, antennae, sensory frills) and the parts move in response to motion:
 * tail-beat/leg-cycle amplitude scales with speed, the body curves into turns,
 * and action (flee/chase/attack/eat) changes the pose. Genome traits shape the
 * parts — aggression the jaw, fear the sensory frills, curiosity the antennae,
 * sociability the eyes.
 *
 * Everything is drawn into a caller-owned PixiJS Graphics in the body's own
 * local frame (heading = +x). The caller handles world placement, rotation to
 * heading, facing flip, glow and shadow.
 */

export type Locomotion = "swim" | "crawl";

export interface BodyAnim {
  /** Ever-increasing time-ish phase (seconds). */
  phase: number;
  /** Normalized recent speed, 0..1. */
  speed: number;
  /** Signed turn rate, roughly -1..1 (left/right body curve). */
  turn: number;
  /** Action index (see protocol ACTION_NAMES). */
  action: number;
  /** Level of detail: 0 = far/simple, 1 = near/full animation. */
  lod: number;
  /** Reduced-motion damping (0 kills oscillation). */
  motion: number;
}

const ACT_CHASE = 4;
const ACT_ATTACK = 5;

/** HSL -> packed 0xRRGGBB int (alpha is passed separately to Pixi fills). */
function hsl(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = ((h % 360) + 360) % 360;
  const x = c * (1 - Math.abs((hh / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}

/** Choose locomotion from environment: animals in water swim, on land crawl. */
export function locomotionFor(inWater: boolean): Locomotion {
  return inWater ? "swim" : "crawl";
}

/** Draw a full creature body into `g` (already cleared by the caller). */
export function drawCreatureBody(g: Graphics, o: RenderOrganism, loco: Locomotion, a: BodyAnim): void {
  const r = 5 + o.size * 7;
  if (o.species === 2) {
    if (loco === "swim") drawAquaticPredator(g, o, r, a);
    else drawCrawler(g, o, r, a, true);
  } else {
    if (loco === "swim") drawAquaticHerbivore(g, o, r, a);
    else drawCrawler(g, o, r, a, false);
  }
}

// ---------------------------------------------------------------------------
// Aquatic herbivore — rounded grazer with paired fins and a soft tail.
// ---------------------------------------------------------------------------
function drawAquaticHerbivore(g: Graphics, o: RenderOrganism, r: number, a: BodyAnim) {
  const hue = o.hue;
  const body = hsl(hue, 0.7, 0.5);
  const belly = hsl(hue, 0.6, 0.68);
  const darkC = hsl(hue, 0.8, 0.3);
  const finC = hsl(hue, 0.65, 0.42);
  const len = r * 1.6;
  const amp = (0.1 + a.speed * 0.22) * a.motion;
  // Body undulation: sample a gentle sine wave along the spine.
  const wave = (t: number) => Math.sin(a.phase * (3 + a.speed * 4) - t * 3.2) * amp * r + a.turn * t * r * 0.5;

  // Tail (behind).
  const tailY = wave(1.15);
  const tflap = Math.sin(a.phase * (3 + a.speed * 4) - 3.4) * (0.4 + a.speed * 0.5) * a.motion;
  g.poly([
    -len * 0.7, wave(0.7),
    -len * 1.15, tailY - r * (0.5 + tflap * 0.3),
    -len * 1.28, tailY,
    -len * 1.15, tailY + r * (0.5 - tflap * 0.3),
  ]).fill({ color: finC, alpha: 0.85 });

  // Dorsal fin.
  g.poly([-r * 0.2, -r * 0.7, r * 0.35, -r * 1.15 - amp * r, r * 0.5, -r * 0.6]).fill({ color: finC, alpha: 0.85 });

  // Pectoral fins (paired, flutter).
  const fin = Math.sin(a.phase * 5) * 0.4 * a.motion;
  for (const side of [-1, 1]) {
    g.poly([
      r * 0.2, side * r * 0.35,
      -r * 0.35, side * (r * 1.0 + fin * r * side),
      -r * 0.1, side * r * 0.5,
    ]).fill({ color: finC, alpha: 0.7 });
  }

  // Main body — a fish egg-shape, drawn as a smooth blob.
  blob(g, [
    [len * 0.98, wave(0.98) * 0.2],
    [len * 0.5, -r * 0.85],
    [-len * 0.55, wave(0.55) - r * 0.55],
    [-len * 0.7, wave(0.7)],
    [-len * 0.55, wave(0.55) + r * 0.55],
    [len * 0.5, r * 0.85],
  ], body);
  // belly highlight
  blob(g, [
    [len * 0.8, -r * 0.1],
    [len * 0.2, -r * 0.5],
    [-len * 0.3, -r * 0.2],
    [-len * 0.3, r * 0.2],
    [len * 0.2, r * 0.5],
  ], belly, 0.75);

  // Head + eye (sociability -> larger, more forward eye).
  const eyeR = r * (0.16 + o.sociability * 0.12);
  g.circle(len * 0.72, -r * 0.12, eyeR).fill({ color: 0x06120c, alpha: 0.95 });
  g.circle(len * 0.72 + eyeR * 0.3, -r * 0.12 - eyeR * 0.3, eyeR * 0.4).fill({ color: 0xffffff, alpha: 0.9 });
  // mouth
  g.moveTo(len * 0.95, r * 0.02).lineTo(len * 0.8, r * 0.16).stroke({ color: darkC, width: 1.4, alpha: 0.8 });
  // antennae/barbels from curiosity
  drawAntennae(g, o, len * 0.85, 0, r, a, darkC);
}

// ---------------------------------------------------------------------------
// Aquatic predator — sleek hunter with a jaw, dorsal spine and swept tail.
// ---------------------------------------------------------------------------
function drawAquaticPredator(g: Graphics, o: RenderOrganism, r: number, a: BodyAnim) {
  const hue = o.hue;
  const body = hsl(hue, 0.8, 0.42);
  const belly = hsl(hue, 0.7, 0.6);
  const darkC = hsl(hue, 0.85, 0.26);
  const finC = hsl(hue, 0.8, 0.34);
  const len = r * 2.0;
  const hunting = a.action === ACT_CHASE || a.action === ACT_ATTACK;
  const beat = 3.5 + a.speed * 5 + (hunting ? 3 : 0);
  const amp = (0.08 + a.speed * 0.26 + (hunting ? 0.1 : 0)) * a.motion;
  const wave = (t: number) => Math.sin(a.phase * beat - t * 3) * amp * r + a.turn * t * r * 0.6;

  // Swept crescent tail.
  const tailY = wave(1.25);
  const tflap = Math.sin(a.phase * beat - 3.75) * (0.6 + a.speed * 0.6) * a.motion;
  g.poly([
    -len * 0.72, wave(0.72),
    -len * 1.25, tailY - r * (0.9 + tflap * 0.4),
    -len * 1.1, tailY,
    -len * 1.25, tailY + r * (0.9 - tflap * 0.4),
  ]).fill({ color: finC, alpha: 0.9 });

  // Dorsal spine fin (angular).
  g.poly([-r * 0.5, -r * 0.7, r * 0.1, -r * 1.35 - amp * r, r * 0.55, -r * 0.75]).fill({ color: darkC, alpha: 0.92 });

  // Pectoral fins swept back.
  for (const side of [-1, 1]) {
    g.poly([r * 0.35, side * r * 0.3, -r * 0.5, side * (r * 0.9), -r * 0.15, side * r * 0.45]).fill({
      color: finC,
      alpha: 0.72,
    });
  }

  // Streamlined body (torpedo).
  blob(g, [
    [len * 1.02, wave(1.02) * 0.1],
    [len * 0.4, -r * 0.72],
    [-len * 0.5, wave(0.5) - r * 0.4],
    [-len * 0.72, wave(0.72)],
    [-len * 0.5, wave(0.5) + r * 0.4],
    [len * 0.4, r * 0.72],
  ], body);
  blob(g, [
    [len * 0.9, 0],
    [len * 0.3, -r * 0.35],
    [-len * 0.4, -r * 0.12],
    [-len * 0.4, r * 0.12],
    [len * 0.3, r * 0.35],
  ], belly, 0.7);

  // Jaw — aggression opens it wider, especially when attacking.
  const gape = (0.12 + o.aggression * 0.5) * (a.action === ACT_ATTACK ? 1.8 : 1);
  const jawTip = len * 1.05;
  g.poly([
    jawTip, -r * 0.05,
    len * 0.62, -r * (0.3 + gape * 0.5),
    len * 0.66, -r * 0.05,
  ]).fill({ color: darkC, alpha: 0.95 });
  g.poly([
    jawTip, r * 0.05,
    len * 0.62, r * (0.3 + gape),
    len * 0.66, r * 0.05,
  ]).fill({ color: darkC, alpha: 0.95 });
  // teeth hint
  g.moveTo(len * 0.95, -r * 0.05).lineTo(len * 0.85, -r * 0.02).lineTo(len * 0.78, -r * 0.08)
    .stroke({ color: 0xf4f0ea, width: 1, alpha: 0.7 });

  // Eye — cold, forward.
  const eyeR = r * (0.14 + o.sociability * 0.06);
  g.circle(len * 0.6, -r * 0.28, eyeR).fill({ color: 0xffe6e0, alpha: 0.95 });
  g.circle(len * 0.6, -r * 0.28, eyeR * 0.45).fill({ color: 0x2a0000, alpha: 0.95 });
  // sensory frills from fear
  drawFrills(g, o, -len * 0.2, r, a, finC);
}

// ---------------------------------------------------------------------------
// Shoreline crawler — segmented body on legs that plant with a walk cycle.
// ---------------------------------------------------------------------------
function drawCrawler(g: Graphics, o: RenderOrganism, r: number, a: BodyAnim, predator: boolean) {
  const hue = o.hue;
  const body = hsl(hue, predator ? 0.75 : 0.6, predator ? 0.4 : 0.46);
  const seg2 = hsl(hue, predator ? 0.8 : 0.65, predator ? 0.34 : 0.4);
  const darkC = hsl(hue, 0.8, 0.25);
  const legC = hsl(hue, 0.7, 0.3);
  const len = r * 1.5;
  const segs = predator ? 3 : 4;
  const step = (len * 1.7) / segs;
  const bob = Math.sin(a.phase * (4 + a.speed * 6)) * 0.12 * r * a.motion;

  // Legs first (behind body): pairs along the trunk, alternating phase for a
  // walk cycle; each foot dips to "plant" at the bottom of its arc.
  const legPairs = predator ? 3 : 3;
  const cadence = 4 + a.speed * 8;
  for (let i = 0; i < legPairs; i++) {
    const bx = len * 0.5 - i * (len * 1.1) / legPairs;
    for (const side of [-1, 1]) {
      const legPhase = a.phase * cadence + i * 1.7 + (side < 0 ? Math.PI : 0);
      const swing = Math.sin(legPhase) * (0.5 + a.speed * 0.6) * a.motion;
      const lift = Math.max(0, Math.cos(legPhase)) * (0.4 + a.speed * 0.5) * a.motion;
      const hipX = bx;
      const hipY = side * r * 0.5;
      const kneeX = hipX + swing * r * 0.5;
      const kneeY = hipY + side * r * 0.6 - lift * r * 0.4;
      const footX = hipX + swing * r * 0.9;
      const footY = hipY + side * r * 1.15 - lift * r * 0.5;
      g.moveTo(hipX, hipY)
        .lineTo(kneeX, kneeY)
        .lineTo(footX, footY)
        .stroke({ color: legC, width: Math.max(1.4, r * 0.14), alpha: 0.9 });
      // foot contact shadow tick
      if (lift < 0.08) g.circle(footX, footY, r * 0.12).fill({ color: 0x04070b, alpha: 0.25 });
    }
  }

  // Segmented trunk.
  for (let i = 0; i < segs; i++) {
    const cx = len * 0.7 - i * step;
    const cy = bob * (1 - i / segs);
    const rr = r * (0.9 - i * 0.12) * (predator ? 0.95 : 1.05);
    g.circle(cx, cy, rr).fill({ color: i % 2 === 0 ? body : seg2, alpha: 0.97 });
    // dorsal plates (armor-ish), stronger on predators
    if (predator || i === 0) {
      g.poly([cx - rr * 0.3, cy - rr * 0.8, cx, cy - rr * 1.15, cx + rr * 0.3, cy - rr * 0.8]).fill({
        color: darkC,
        alpha: 0.7,
      });
    }
  }

  // Head segment detail: eyes + (predator) mandibles / (herbivore) snout.
  const hx = len * 0.7;
  const hy = bob;
  const eyeR = r * (0.14 + o.sociability * 0.1);
  for (const side of [-1, 1]) {
    g.circle(hx + r * 0.2, hy + side * r * 0.3, eyeR).fill({ color: 0x06120c, alpha: 0.95 });
    g.circle(hx + r * 0.2 + eyeR * 0.25, hy + side * r * 0.3 - eyeR * 0.25, eyeR * 0.4).fill({
      color: 0xffffff,
      alpha: 0.85,
    });
  }
  if (predator) {
    const gape = 0.2 + o.aggression * 0.5;
    for (const side of [-1, 1]) {
      g.moveTo(hx + r * 0.6, hy + side * r * 0.15)
        .lineTo(hx + r * 1.15, hy + side * (r * 0.15 + gape * r))
        .stroke({ color: darkC, width: Math.max(1.4, r * 0.16), alpha: 0.95 });
    }
  } else {
    g.circle(hx + r * 0.7, hy, r * 0.3).fill({ color: seg2, alpha: 0.95 });
  }
  // antennae (curiosity) up front
  drawAntennae(g, o, hx + r * 0.5, hy, r, a, darkC);
}

// ---------------------------------------------------------------------------
// Shared appendages
// ---------------------------------------------------------------------------
function drawAntennae(g: Graphics, o: RenderOrganism, x: number, y: number, r: number, a: BodyAnim, color: number) {
  if (o.curiosity < 0.15) return;
  const n = 2;
  const wiggle = Math.sin(a.phase * 6) * 0.4 * a.motion * o.curiosity;
  for (let i = 0; i < n; i++) {
    const side = i === 0 ? -1 : 1;
    const baseA = side * 0.5;
    const l = r * (0.5 + o.curiosity * 0.9);
    g.moveTo(x, y + side * r * 0.15)
      .quadraticCurveTo(
        x + Math.cos(baseA) * l * 0.6,
        y + side * r * 0.15 - l * 0.5 + wiggle * r,
        x + Math.cos(baseA + wiggle) * l,
        y + side * r * 0.1 - l + wiggle * r,
      )
      .stroke({ color, width: 1.3, alpha: 0.8 });
  }
}

function drawFrills(g: Graphics, o: RenderOrganism, x: number, r: number, a: BodyAnim, color: number) {
  if (o.fear < 0.35) return;
  const n = 3;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const fx = x - t * r * 1.2;
    const flick = Math.sin(a.phase * 8 + i) * 0.3 * a.motion * o.fear;
    for (const side of [-1, 1]) {
      g.moveTo(fx, side * r * 0.4)
        .lineTo(fx - r * 0.2, side * (r * 0.9 + flick * r))
        .stroke({ color, width: 1.1, alpha: 0.6 });
    }
  }
}

// ---------------------------------------------------------------------------
// Small drawing helpers
// ---------------------------------------------------------------------------

/** Draw a smooth closed blob through control points using quadratic segments
 * (Catmull-Rom-ish midpoint smoothing) — organic bodies without hard corners. */
function blob(g: Graphics, pts: [number, number][], color: number, alpha = 1): void {
  const n = pts.length;
  if (n < 3) return;
  const mid = (i: number, j: number): [number, number] => [
    (pts[i][0] + pts[j][0]) / 2,
    (pts[i][1] + pts[j][1]) / 2,
  ];
  const m = mid(n - 1, 0);
  g.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) {
    const next = mid(i, (i + 1) % n);
    g.quadraticCurveTo(pts[i][0], pts[i][1], next[0], next[1]);
  }
  g.closePath().fill({ color, alpha });
}
