import { Graphics } from "pixi.js";
import type { RenderOrganism } from "../sim/protocol";

/**
 * Procedural plant forms. A "plant" organism is drawn as a real piece of
 * flora whose form is chosen by its habitat (submerged / shoreline / dry
 * ground / higher ground) and its own genome, so the world grows algae in
 * the water, reeds and grasses along the shore, shrubs, saplings, fruiting
 * bushes and the occasional mushroom on land — instead of one green symbol
 * repeated everywhere.
 *
 * Drawn base-at-origin, growing upward (−y), in the plant's local frame. The
 * caller applies world position (with the base sitting on the ground) and a
 * gentle wind sway.
 */

export type PlantForm = "algae" | "reed" | "grass" | "shrub" | "sapling" | "fruiting" | "mushroom";

/** Deterministically choose a plant form from habitat + genome. */
export function plantFormFor(o: RenderOrganism, inWater: boolean, landHeight: number): PlantForm {
  if (inWater) return "algae";
  const h = hash01(o.id);
  if (landHeight < 0.06) return h < 0.6 ? "reed" : "grass";
  if (landHeight < 0.16) return o.proportion > 1.15 ? "shrub" : h < 0.5 ? "grass" : "shrub";
  // Higher / drier ground: taller flora, some fruiting, rare mushrooms in shade.
  if (h < 0.12) return "mushroom";
  if (o.proportion > 1.2 || o.size > 1.3) return "sapling";
  if (o.sociability > 0.6 && h < 0.5) return "fruiting";
  return "shrub";
}

function hash01(id: number): number {
  let n = (id * 2654435761) >>> 0;
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

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

/** Green-ish hue for foliage: nudge the genome hue toward the green band so
 * plants read as vegetation, but keep per-plant variation. */
function foliageHue(baseHue: number): number {
  return 95 + ((baseHue % 40) - 20) * 0.8; // ~75..115, green-leaning
}

/**
 * Draw a plant. `phase` drives wind sway (already damped by `motion`, 0 = off).
 * `growth` 0..1 optionally scales a young plant down (energy-derived).
 */
export function drawPlantForm(
  g: Graphics,
  o: RenderOrganism,
  form: PlantForm,
  phase: number,
  motion: number,
  growth = 1,
): void {
  const r = (5 + o.size * 7) * (0.55 + growth * 0.45);
  const sway = Math.sin(phase * 1.3 + o.id) * 0.12 * motion;
  const hue = foliageHue(o.hue);
  const leaf = hsl(hue, 0.5, 0.42);
  const leafHi = hsl(hue, 0.55, 0.56);
  const dark = hsl(hue, 0.55, 0.28);
  const stem = hsl(hue - 15, 0.4, 0.32);

  switch (form) {
    case "algae": {
      const strands = 3 + Math.floor(o.proportion * 2);
      const aHue = hsl((hue + 40) % 360, 0.5, 0.4);
      for (let i = 0; i < strands; i++) {
        const bx = (i - strands / 2) * r * 0.5;
        const h = r * (1.4 + o.proportion * 0.8);
        const s = sway + Math.sin(phase * 1.8 + i) * 0.18 * motion;
        g.moveTo(bx, 0)
          .quadraticCurveTo(bx + s * r, -h * 0.5, bx + s * r * 1.6, -h)
          .stroke({ color: aHue, width: Math.max(1.4, r * 0.22), alpha: 0.75 });
        g.circle(bx + s * r * 1.6, -h, r * 0.16).fill({ color: leafHi, alpha: 0.7 });
      }
      break;
    }
    case "reed": {
      const blades = 3 + Math.floor(o.proportion * 3);
      for (let i = 0; i < blades; i++) {
        const bx = (i - blades / 2) * r * 0.35;
        const h = r * (2.0 + o.proportion);
        const s = sway + (i - blades / 2) * 0.05;
        g.moveTo(bx, 0)
          .quadraticCurveTo(bx + s * r * 0.5, -h * 0.5, bx + s * r, -h)
          .stroke({ color: stem, width: Math.max(1.2, r * 0.16), alpha: 0.9 });
        // seed head
        g.ellipse(bx + s * r, -h, r * 0.14, r * 0.4).fill({ color: hsl(45, 0.4, 0.4), alpha: 0.85 });
      }
      break;
    }
    case "grass": {
      const blades = 5 + Math.floor(o.proportion * 4);
      for (let i = 0; i < blades; i++) {
        const a = (i / (blades - 1) - 0.5) * 1.3;
        const h = r * (0.9 + (i % 2) * 0.4);
        g.moveTo(0, 0)
          .quadraticCurveTo(Math.sin(a) * r * 0.6, -h * 0.6, Math.sin(a + sway) * r * 1.1, -h)
          .stroke({ color: i % 2 === 0 ? leaf : leafHi, width: Math.max(1, r * 0.14), alpha: 0.9 });
      }
      break;
    }
    case "shrub": {
      // short stem + rounded leafy mass
      g.moveTo(0, 0).lineTo(sway * r, -r * 0.6).stroke({ color: stem, width: Math.max(1.4, r * 0.2), alpha: 0.9 });
      const cx = sway * r;
      const cy = -r * (0.9 + o.proportion * 0.3);
      g.circle(cx, cy, r * 0.85).fill({ color: dark, alpha: 0.95 });
      g.circle(cx - r * 0.35, cy - r * 0.2, r * 0.55).fill({ color: leaf, alpha: 0.95 });
      g.circle(cx + r * 0.3, cy + r * 0.1, r * 0.45).fill({ color: leaf, alpha: 0.9 });
      g.circle(cx - r * 0.5, cy - r * 0.45, r * 0.25).fill({ color: leafHi, alpha: 0.85 });
      break;
    }
    case "fruiting": {
      g.moveTo(0, 0).lineTo(sway * r, -r * 0.6).stroke({ color: stem, width: Math.max(1.4, r * 0.2), alpha: 0.9 });
      const cx = sway * r;
      const cy = -r * 1.0;
      g.circle(cx, cy, r * 0.8).fill({ color: dark, alpha: 0.95 });
      g.circle(cx - r * 0.3, cy - r * 0.2, r * 0.5).fill({ color: leaf, alpha: 0.95 });
      // berries
      const berry = hsl((o.hue + 320) % 360, 0.7, 0.55);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + o.id;
        g.circle(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.5, r * 0.16).fill({ color: berry, alpha: 0.95 });
      }
      break;
    }
    case "sapling": {
      const h = r * (2.2 + o.proportion);
      // trunk
      g.moveTo(0, 0)
        .quadraticCurveTo(sway * r * 0.5, -h * 0.5, sway * r, -h * 0.75)
        .stroke({ color: stem, width: Math.max(1.6, r * 0.24), alpha: 0.95 });
      // canopy
      const cx = sway * r;
      const cy = -h * 0.8;
      g.circle(cx, cy, r * 0.9).fill({ color: dark, alpha: 0.95 });
      g.circle(cx - r * 0.4, cy - r * 0.25, r * 0.6).fill({ color: leaf, alpha: 0.95 });
      g.circle(cx + r * 0.35, cy + r * 0.1, r * 0.5).fill({ color: leaf, alpha: 0.9 });
      g.circle(cx - r * 0.55, cy - r * 0.5, r * 0.28).fill({ color: leafHi, alpha: 0.85 });
      break;
    }
    case "mushroom": {
      const capHue = hsl((o.hue + 20) % 360, 0.55, 0.5);
      const h = r * 1.1;
      // stem
      g.moveTo(-r * 0.18, 0)
        .lineTo(-r * 0.1, -h)
        .lineTo(r * 0.1, -h)
        .lineTo(r * 0.18, 0)
        .fill({ color: hsl(40, 0.2, 0.78), alpha: 0.95 });
      // cap
      g.ellipse(0, -h, r * 0.8, r * 0.5).fill({ color: capHue, alpha: 0.96 });
      g.ellipse(-r * 0.25, -h - r * 0.1, r * 0.3, r * 0.18).fill({ color: leafHi, alpha: 0.5 });
      // spots
      for (let i = 0; i < 3; i++) {
        g.circle((i - 1) * r * 0.3, -h - r * 0.05, r * 0.08).fill({ color: 0xf3efe6, alpha: 0.8 });
      }
      break;
    }
  }
}
