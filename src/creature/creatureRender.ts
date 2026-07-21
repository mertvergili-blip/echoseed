import type { CreatureEngine } from "./creatureEngine";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

/**
 * Canvas-2D renderer for the desktop creature. Procedural body derived from
 * genome; soft bioluminescent particles; expression driven by mood/activity.
 */
export class CreatureRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private particles: Particle[] = [];
  private w = 0;
  private h = 0;

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

  draw(engine: CreatureEngine, dt: number) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    const g = engine.genome;
    const cx = engine.x * this.w;
    const cy = engine.y * this.h;
    const baseR = 18 + g.bodySize * 16;
    const hue = g.visualHue;
    const asleep = engine.activity === "sleep";
    const mood = engine.mood;

    const bob = Math.sin(engine.bob) * (asleep ? 1 : 3);

    // Emit particles occasionally (more when happy/curious).
    const emitRate = asleep ? 0.02 : 0.08 + (mood === "happy" ? 0.12 : 0) + g.curiosity * 0.05;
    if (Math.random() < emitRate) {
      this.particles.push({
        x: cx + (Math.random() - 0.5) * baseR,
        y: cy + (Math.random() - 0.5) * baseR,
        vx: (Math.random() - 0.5) * 8,
        vy: -10 - Math.random() * 12,
        life: 0,
        max: 1 + Math.random() * 1.5,
      });
    }
    this.drawParticles(dt, hue);

    // Glow aura.
    const auraR = baseR * 2.4;
    const grd = ctx.createRadialGradient(cx, cy + bob, 0, cx, cy + bob, auraR);
    grd.addColorStop(0, `hsla(${hue}, 80%, 60%, ${asleep ? 0.25 : 0.4})`);
    grd.addColorStop(1, `hsla(${hue}, 80%, 60%, 0)`);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, cy + bob, auraR, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy + bob);
    ctx.scale(engine.facing, 1);

    // Body — organic blob with genome-driven wobble.
    const lobes = 8;
    ctx.beginPath();
    for (let i = 0; i <= lobes; i++) {
      const a = (i / lobes) * Math.PI * 2;
      const wobble =
        1 +
        Math.sin(a * 3 + engine.bob) * 0.08 * g.bodyProportion +
        Math.cos(a * 2 - engine.bob * 0.7) * 0.05;
      const rr = baseR * wobble * (asleep ? 0.9 : 1);
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr * (asleep ? 0.7 : 0.92);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const bodyGrad = ctx.createRadialGradient(-baseR * 0.3, -baseR * 0.3, 0, 0, 0, baseR * 1.2);
    bodyGrad.addColorStop(0, `hsl(${hue}, 75%, 62%)`);
    bodyGrad.addColorStop(1, `hsl(${hue}, 80%, 34%)`);
    ctx.fillStyle = bodyGrad;
    ctx.shadowColor = `hsl(${hue}, 90%, 60%)`;
    ctx.shadowBlur = 20;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner core.
    ctx.beginPath();
    ctx.arc(0, 0, baseR * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, 90%, 80%, 0.85)`;
    ctx.fill();

    // Tendrils (limbs) — length from bodyProportion.
    const tendrils = 3 + Math.floor(g.bodyProportion * 2);
    ctx.strokeStyle = `hsl(${hue}, 70%, 45%)`;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    for (let i = 0; i < tendrils; i++) {
      const a = Math.PI * 0.35 + (i / (tendrils - 1)) * Math.PI * 0.3 + Math.PI * 0.5;
      const len = baseR * (0.9 + g.bodyProportion * 0.8);
      const sway = Math.sin(engine.bob * 1.5 + i) * 0.3;
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

    // Eyes / expression.
    this.drawFace(ctx, baseR, engine, asleep, mood);

    ctx.restore();
  }

  private drawFace(
    ctx: CanvasRenderingContext2D,
    r: number,
    engine: CreatureEngine,
    asleep: boolean,
    mood: string,
  ) {
    const eyeX = r * 0.32;
    const eyeY = -r * 0.12;
    const blinkPhase = (engine.blink % 4) < 0.12; // occasional blink
    ctx.fillStyle = "#05070c";

    if (asleep || blinkPhase) {
      // Closed eyes: gentle arcs.
      ctx.strokeStyle = "#05070c";
      ctx.lineWidth = 2;
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx * eyeX, eyeY, r * 0.14, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      }
    } else {
      const eyeR = r * (mood === "curious" ? 0.16 : 0.13);
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx * eyeX, eyeY, eyeR, 0, Math.PI * 2);
        ctx.fill();
        // highlight
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(sx * eyeX + eyeR * 0.3, eyeY - eyeR * 0.3, eyeR * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#05070c";
      }
    }

    // Mouth expression.
    if (!asleep) {
      ctx.strokeStyle = "rgba(5,7,12,0.7)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      const my = r * 0.28;
      if (mood === "happy" || mood === "content") {
        ctx.arc(0, my - r * 0.1, r * 0.2, 0.1 * Math.PI, 0.9 * Math.PI);
      } else if (mood === "hungry" || mood === "lonely") {
        ctx.arc(0, my + r * 0.12, r * 0.2, 1.15 * Math.PI, 1.85 * Math.PI);
      } else {
        ctx.moveTo(-r * 0.12, my);
        ctx.lineTo(r * 0.12, my);
      }
      ctx.stroke();
    }
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
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5 + t * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue}, 90%, 70%, ${t * 0.6})`;
      ctx.fill();
    }
  }
}
