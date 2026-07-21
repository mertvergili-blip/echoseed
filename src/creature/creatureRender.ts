import type { CreatureEngine, CreatureMood } from "./creatureEngine";

// Decorative wobble/bounce amplitude is dampened for prefers-reduced-motion
// users; the underlying engine.bob timer keeps driving real movement/
// activity logic unchanged (see CreatureEngine) — only this renderer's
// cosmetic breathing/sway/particle output is scaled down.
const REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const MOTION_AMP = REDUCED_MOTION ? 0 : 1;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  hueShift: number;
  size: number;
}

/** Per-mood visual profile. Renderers interpolate between two of these
 * (see CreatureEngine.visualMoodBlend) instead of hard-switching, so mood
 * changes read as a brief transition rather than an instant flip. */
interface MoodProfile {
  eyeOpen: number; // 0 closed .. 1 wide
  eyeSize: number; // relative multiplier
  mouthCurve: number; // -1 frown .. 1 smile, 0 flat
  glow: number; // aura intensity multiplier
  squish: number; // 0 none .. 1 strongly compressed vertically
  antennaPerk: number; // 0 drooped .. 1 alert/raised
  hueShift: number; // degrees added to base hue
  jitter: number; // 0 none .. 1 strong tremor
  satMul: number; // saturation multiplier
  lightMul: number; // lightness multiplier
}

const MOOD_PROFILES: Record<CreatureMood, MoodProfile> = {
  neutral: { eyeOpen: 0.75, eyeSize: 1, mouthCurve: 0.1, glow: 1, squish: 0, antennaPerk: 0.4, hueShift: 0, jitter: 0, satMul: 1, lightMul: 1 },
  happy: { eyeOpen: 0.85, eyeSize: 1.05, mouthCurve: 0.75, glow: 1.25, squish: 0.08, antennaPerk: 0.7, hueShift: 6, jitter: 0, satMul: 1.1, lightMul: 1.08 },
  curious: { eyeOpen: 1, eyeSize: 1.2, mouthCurve: 0.25, glow: 1.1, squish: 0, antennaPerk: 1, hueShift: -8, jitter: 0.05, satMul: 1.05, lightMul: 1.03 },
  hungry: { eyeOpen: 0.55, eyeSize: 0.95, mouthCurve: -0.5, glow: 0.85, squish: 0.05, antennaPerk: 0.25, hueShift: 22, jitter: 0.1, satMul: 0.9, lightMul: 0.92 },
  tired: { eyeOpen: 0.3, eyeSize: 0.9, mouthCurve: -0.15, glow: 0.7, squish: 0.15, antennaPerk: 0.1, hueShift: -12, jitter: 0, satMul: 0.75, lightMul: 0.8 },
  sleeping: { eyeOpen: 0, eyeSize: 0.9, mouthCurve: 0, glow: 0.5, squish: 0.25, antennaPerk: 0, hueShift: -18, jitter: 0, satMul: 0.6, lightMul: 0.7 },
  scared: { eyeOpen: 1, eyeSize: 1.35, mouthCurve: -0.6, glow: 0.9, squish: -0.1, antennaPerk: 0.85, hueShift: -30, jitter: 0.9, satMul: 1.2, lightMul: 0.95 },
  lonely: { eyeOpen: 0.55, eyeSize: 0.95, mouthCurve: -0.4, glow: 0.65, squish: 0.05, antennaPerk: 0.15, hueShift: -25, jitter: 0.02, satMul: 0.7, lightMul: 0.82 },
  excited: { eyeOpen: 1, eyeSize: 1.25, mouthCurve: 0.9, glow: 1.5, squish: -0.12, antennaPerk: 1, hueShift: 14, jitter: 0.15, satMul: 1.25, lightMul: 1.15 },
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function lerpProfile(a: MoodProfile, b: MoodProfile, t: number): MoodProfile {
  return {
    eyeOpen: lerp(a.eyeOpen, b.eyeOpen, t),
    eyeSize: lerp(a.eyeSize, b.eyeSize, t),
    mouthCurve: lerp(a.mouthCurve, b.mouthCurve, t),
    glow: lerp(a.glow, b.glow, t),
    squish: lerp(a.squish, b.squish, t),
    antennaPerk: lerp(a.antennaPerk, b.antennaPerk, t),
    hueShift: lerp(a.hueShift, b.hueShift, t),
    jitter: lerp(a.jitter, b.jitter, t),
    satMul: lerp(a.satMul, b.satMul, t),
    lightMul: lerp(a.lightMul, b.lightMul, t),
  };
}

/**
 * Canvas-2D renderer for the desktop creature. Procedural body derived from
 * genome; soft bioluminescent particles; expression driven by a blended mood
 * profile so state changes read as a brief transition, not a hard cut.
 */
export class CreatureRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private particles: Particle[] = [];
  private w = 0;
  private h = 0;
  private lookAngle = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Trigger a burst of particles distinguishable from ambient emission —
   * used for Feed/Pet reactions instead of a generic sparkle. */
  burst(kind: "feed" | "pet" | "wake", cx: number, cy: number, r: number) {
    const n = kind === "pet" ? 10 : 7;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const spread = kind === "wake" ? 0.4 : 1;
      this.particles.push({
        x: cx + Math.cos(a) * r * 0.3,
        y: cy + Math.sin(a) * r * 0.3,
        vx: Math.cos(a) * (10 + Math.random() * 14) * spread,
        vy: Math.sin(a) * (10 + Math.random() * 14) * spread - 6,
        life: 0,
        max: 0.6 + Math.random() * 0.7,
        hueShift: kind === "feed" ? 40 : kind === "pet" ? -10 : 0,
        size: 1.5 + Math.random() * 1.8,
      });
    }
  }

  draw(engine: CreatureEngine, dt: number) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    const g = engine.genome;
    const cx = engine.x * this.w;
    const cy = engine.y * this.h;
    const baseR = 18 + g.bodySize * 16;

    const { from, to, t } = engine.visualMoodBlend();
    const profile = lerpProfile(MOOD_PROFILES[from], MOOD_PROFILES[to], t);
    const hue = (g.visualHue + profile.hueShift + 360) % 360;
    const asleep = engine.mood === "sleeping";

    // Return-to-terrarium dissolve: shrink + fade + extra particles.
    const returning = engine.isReturning;
    const rp = engine.returnProgress;
    const scale = returning ? Math.max(0.02, 1 - rp) : 1;
    const alpha = returning ? Math.max(0, 1 - rp * 1.15) : 1;
    if (returning && Math.random() < 0.35) {
      this.burst("wake", cx, cy, baseR * (1 - rp * 0.6));
    }

    const jitterAmp = (profile.jitter + g.fear * 0.15) * 2.5 * MOTION_AMP;
    const jitterX = jitterAmp ? (Math.random() - 0.5) * jitterAmp : 0;
    const jitterY = jitterAmp ? (Math.random() - 0.5) * jitterAmp : 0;
    const bob = Math.sin(engine.bob) * (asleep ? 1 : 3) * MOTION_AMP + jitterY;

    // Emit ambient particles (rate/hue react to mood; bursts happen separately).
    const emitRate = asleep ? 0.015 : 0.05 + profile.glow * 0.05 + g.curiosity * 0.04;
    if (!returning && Math.random() < emitRate) {
      this.particles.push({
        x: cx + (Math.random() - 0.5) * baseR,
        y: cy + (Math.random() - 0.5) * baseR,
        vx: (Math.random() - 0.5) * 8,
        vy: -10 - Math.random() * 12,
        life: 0,
        max: 1 + Math.random() * 1.5,
        hueShift: 0,
        size: 1.5,
      });
    }
    this.drawParticles(dt, hue);

    ctx.save();
    ctx.globalAlpha = alpha;

    // Glow aura — intensity from the blended mood profile.
    const auraR = baseR * 2.4 * scale;
    const grd = ctx.createRadialGradient(cx + jitterX, cy + bob, 0, cx + jitterX, cy + bob, auraR);
    const auraA = (asleep ? 0.22 : 0.4) * profile.glow;
    grd.addColorStop(0, `hsla(${hue}, ${80 * profile.satMul}%, ${60 * profile.lightMul}%, ${auraA})`);
    grd.addColorStop(1, `hsla(${hue}, 80%, 60%, 0)`);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx + jitterX, cy + bob, auraR, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(cx + jitterX, cy + bob);
    ctx.scale(engine.facing * scale, scale * (1 - profile.squish * 0.25));

    // Body — organic blob with genome-driven wobble. Aggression sharpens the
    // lobes (more angular, less round); sleepTendency softens/droops it.
    const lobes = 8;
    const sharpness = 0.08 + g.aggression * 0.14;
    ctx.beginPath();
    for (let i = 0; i <= lobes; i++) {
      const a = (i / lobes) * Math.PI * 2;
      const wobble =
        1 +
        Math.sin(a * 3 + engine.bob) * sharpness * g.bodyProportion * MOTION_AMP +
        Math.cos(a * 2 - engine.bob * 0.7) * 0.05 * MOTION_AMP;
      const rr = baseR * wobble * (asleep ? 0.9 : 1);
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr * (asleep ? 0.7 : 0.92 - profile.squish * 0.1);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const bodyGrad = ctx.createRadialGradient(-baseR * 0.3, -baseR * 0.3, 0, 0, 0, baseR * 1.2);
    bodyGrad.addColorStop(0, `hsl(${hue}, ${75 * profile.satMul}%, ${62 * profile.lightMul}%)`);
    bodyGrad.addColorStop(1, `hsl(${hue}, ${80 * profile.satMul}%, ${34 * profile.lightMul}%)`);
    ctx.fillStyle = bodyGrad;
    ctx.shadowColor = `hsl(${hue}, 90%, 60%)`;
    ctx.shadowBlur = 20 * profile.glow;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner core.
    ctx.beginPath();
    ctx.arc(0, 0, baseR * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, 90%, 80%, 0.85)`;
    ctx.fill();

    // Tendrils/antennae — length from bodyProportion, perkiness from mood
    // (curiosity raises them) blended with the genome's curiosity baseline.
    const tendrils = 3 + Math.floor(g.bodyProportion * 2);
    const perk = Math.max(profile.antennaPerk, g.curiosity * 0.5);
    ctx.strokeStyle = `hsl(${hue}, 70%, 45%)`;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    for (let i = 0; i < tendrils; i++) {
      const spread = Math.PI * 0.3 * (0.5 + perk * 0.5);
      const a = Math.PI * 0.35 + (i / Math.max(1, tendrils - 1)) * spread + Math.PI * 0.5 - spread * 0.5;
      const len = baseR * (0.9 + g.bodyProportion * 0.8) * (0.6 + perk * 0.4);
      const lookBias = this.lookAngle * 0.25 * perk;
      const sway = Math.sin(engine.bob * 1.5 + i) * 0.3 * MOTION_AMP + lookBias;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * baseR * 0.6, Math.sin(a) * baseR * 0.6);
      ctx.quadraticCurveTo(
        Math.cos(a + sway) * len * 0.8,
        Math.sin(a) * len * 0.8 + 6,
        Math.cos(a + sway) * len,
        Math.sin(a) * len + 10,
      );
      ctx.stroke();
    }

    this.drawFace(ctx, baseR, engine, profile);

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawFace(ctx: CanvasRenderingContext2D, r: number, engine: CreatureEngine, profile: MoodProfile) {
    const g = engine.genome;
    // Sociability widens eye spacing/openness baseline; sleepTendency caps
    // how wide the eyes can ever look (droopier resting expression).
    const eyeOpen = Math.min(profile.eyeOpen, 1 - g.sleepTendency * 0.2) * (1 - engine.wakeAnim * 0.7);
    const eyeX = r * (0.28 + g.sociability * 0.08);
    const eyeY = -r * 0.12;
    const blinkPhase = (engine.blink % 4) < 0.12 && eyeOpen > 0.15;
    const closed = eyeOpen < 0.12 || blinkPhase;

    if (closed) {
      ctx.strokeStyle = "#05070c";
      ctx.lineWidth = 2;
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx * eyeX, eyeY, r * 0.14, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      }
    } else {
      const eyeR = r * 0.13 * profile.eyeSize * (0.5 + eyeOpen * 0.5) * (1 + g.sociability * 0.15);
      // Pupils glance toward the cursor slightly (curious) — a subtle look,
      // not a full head turn.
      const glanceX = this.lookAngle * eyeR * 0.3;
      for (const sx of [-1, 1]) {
        ctx.fillStyle = "#05070c";
        ctx.beginPath();
        ctx.arc(sx * eyeX, eyeY, eyeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(sx * eyeX + eyeR * 0.3 + glanceX, eyeY - eyeR * 0.3, eyeR * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Mouth: curve comes straight from the blended mood profile.
    if (!closed || profile.mouthCurve !== 0) {
      ctx.strokeStyle = "rgba(5,7,12,0.7)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      const my = r * 0.28;
      const curve = profile.mouthCurve;
      if (curve > 0.15) {
        ctx.arc(0, my - r * 0.1 * curve, r * (0.15 + curve * 0.1), 0.1 * Math.PI, 0.9 * Math.PI);
      } else if (curve < -0.15) {
        ctx.arc(0, my + r * 0.12 * -curve, r * (0.15 - curve * 0.1), 1.15 * Math.PI, 1.85 * Math.PI);
      } else {
        ctx.moveTo(-r * 0.12, my);
        ctx.lineTo(r * 0.12, my);
      }
      ctx.stroke();
    }
  }

  /** Update the ambient "look toward cursor" bias — a small, cheap glance
   * rather than a full head turn. Call once per frame with the same
   * window-local cursor coords passed to CreatureEngine.update(). */
  setLookTarget(engine: CreatureEngine, cursor: { x: number; y: number } | null) {
    const target = cursor ? Math.sign(cursor.x - engine.x) : 0;
    this.lookAngle += (target - this.lookAngle) * 0.08;
  }

  private drawParticles(dt: number, hue: number) {
    const ctx = this.ctx;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 6 * dt;
      const t = 1 - p.life / p.max;
      const h = (hue + p.hueShift + 360) % 360;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 1.4 * t + p.size * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${h}, 90%, 70%, ${t * 0.6})`;
      ctx.fill();
    }
  }
}
