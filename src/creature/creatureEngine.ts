import type { Genome } from "../sim/types";
import type { CreatureState } from "../sim/save";

export type CreatureMood = "content" | "happy" | "curious" | "hungry" | "sleepy" | "lonely";
export type CreatureActivity = "idle" | "wander" | "play" | "sleep" | "follow" | "eat";

/**
 * Standalone behavioral model for the ascended desktop creature. Its needs
 * (hunger, energy, trust, curiosity, mood) evolve over real time and its
 * behaviour is modulated by its inherited genome. No OS spying — only the
 * clock and in-app interactions drive it.
 */
export class CreatureEngine {
  genome: Genome;
  state: CreatureState;
  activity: CreatureActivity = "idle";
  // Local position within the creature window/canvas (procedural motion).
  x = 0.5;
  y = 0.5;
  vx = 0;
  vy = 0;
  facing = 1;
  private wanderTarget = { x: 0.5, y: 0.5 };
  private activityTimer = 0;
  private idleSeconds = 0;
  blink = 0;
  bob = 0;

  constructor(genome: Genome, state: CreatureState) {
    this.genome = genome;
    this.state = state;
  }

  get mood(): CreatureMood {
    const s = this.state;
    if (this.isNight() && s.energy < 0.4) return "sleepy";
    if (s.hunger > 0.7) return "hungry";
    if (s.energy < 0.25) return "sleepy";
    if (this.idleSeconds > 120 && s.trust < 0.6) return "lonely";
    if (s.curiosity > 0.7) return "curious";
    if (s.mood > 0.7) return "happy";
    return "content";
  }

  isNight(): boolean {
    const h = new Date().getHours();
    return h >= 22 || h < 7;
  }

  /** Feed: reduces hunger, boosts mood & trust. */
  feed() {
    this.state.hunger = Math.max(0, this.state.hunger - 0.4);
    this.state.energy = Math.min(1, this.state.energy + 0.15);
    this.state.mood = Math.min(1, this.state.mood + 0.2);
    this.state.trust = Math.min(1, this.state.trust + 0.05);
    this.state.lastInteractionTick = Date.now();
    this.idleSeconds = 0;
    this.activity = "eat";
    this.activityTimer = 3;
  }

  /** Pet: boosts trust & mood strongly. */
  pet() {
    this.state.mood = Math.min(1, this.state.mood + 0.25);
    this.state.trust = Math.min(1, this.state.trust + 0.12);
    this.state.curiosity = Math.min(1, this.state.curiosity + 0.08);
    this.state.lastInteractionTick = Date.now();
    this.idleSeconds = 0;
    this.activity = "play";
    this.activityTimer = 2.5;
  }

  /** Put to sleep manually. */
  sleep() {
    this.activity = "sleep";
    this.activityTimer = 8;
    this.state.lastInteractionTick = Date.now();
  }

  /**
   * Advance the creature by dt seconds. Returns whether a window-scale
   * autonomous movement is desired (used by Tauri to nudge the window).
   */
  update(dt: number): void {
    const s = this.state;
    const g = this.genome;

    // Needs drift over time (per-minute rates scaled by metabolism/genome).
    s.hunger = clamp01(s.hunger + dt * 0.01 * (0.6 + g.metabolism * 0.4));
    if (this.activity === "sleep") {
      s.energy = clamp01(s.energy + dt * 0.03);
    } else {
      s.energy = clamp01(s.energy - dt * 0.006 * (0.6 + g.metabolism * 0.3));
    }
    // Mood decays toward neutral, faster if hungry/tired.
    const moodTarget = 0.5 - s.hunger * 0.3 + s.trust * 0.2 - (s.energy < 0.3 ? 0.2 : 0);
    s.mood += (clamp01(moodTarget) - s.mood) * dt * 0.05;
    s.mood = clamp01(s.mood);
    // Curiosity slowly regenerates.
    s.curiosity = clamp01(s.curiosity + dt * 0.002 * (0.5 + g.curiosity));

    // Track idleness (time since interaction).
    this.idleSeconds += dt;

    this.blink += dt;
    this.bob += dt * (2 + g.movementSpeed);

    // Behaviour selection.
    this.activityTimer -= dt;
    if (this.activityTimer <= 0) this.chooseActivity();

    this.move(dt);
  }

  private chooseActivity() {
    const g = this.genome;
    const s = this.state;

    if (this.isNight() && s.energy < 0.5 && g.sleepTendency > 0.4) {
      this.activity = "sleep";
      this.activityTimer = rand(6, 14);
      return;
    }
    if (s.energy < 0.2) {
      this.activity = "sleep";
      this.activityTimer = rand(4, 8);
      return;
    }
    // Self-directed idle behaviours when alone for a while.
    const lonely = this.idleSeconds > 60;
    const roll = Math.random();
    if (this.activity === "sleep" && s.energy < 0.7) {
      this.activityTimer = rand(3, 6);
      return; // keep sleeping until rested
    }
    if (roll < 0.15 + g.curiosity * 0.2 && (lonely || s.curiosity > 0.5)) {
      this.activity = "play";
      this.activityTimer = rand(2, 5);
    } else if (roll < 0.55 + g.movementSpeed * 0.15) {
      this.activity = "wander";
      this.activityTimer = rand(3, 7);
      this.wanderTarget = {
        x: rand(0.2, 0.8),
        y: rand(0.3, 0.75),
      };
    } else {
      this.activity = "idle";
      this.activityTimer = rand(2, 5);
    }
  }

  private move(dt: number) {
    const g = this.genome;
    const speed = (0.15 + g.movementSpeed * 0.25) * dt;

    let tx = this.x;
    let ty = this.y;

    switch (this.activity) {
      case "wander":
      case "follow":
        tx = this.wanderTarget.x;
        ty = this.wanderTarget.y;
        break;
      case "play":
        // bouncy little circles
        tx = 0.5 + Math.cos(this.bob * 2) * 0.2;
        ty = 0.55 + Math.abs(Math.sin(this.bob * 3)) * -0.15;
        break;
      case "eat":
        tx = 0.5;
        ty = 0.6;
        break;
      case "sleep":
        tx = 0.5;
        ty = 0.62;
        break;
      case "idle":
      default:
        tx = 0.5 + Math.sin(this.bob * 0.3) * 0.05;
        ty = 0.55;
        break;
    }

    const dx = tx - this.x;
    const dy = ty - this.y;
    this.vx += (dx * speed - this.vx) * 0.2;
    this.vy += (dy * speed - this.vy) * 0.2;
    this.x = clamp01(this.x + this.vx);
    this.y = clamp01(this.y + this.vy);
    if (Math.abs(this.vx) > 0.0005) this.facing = this.vx > 0 ? 1 : -1;
  }
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}
function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
