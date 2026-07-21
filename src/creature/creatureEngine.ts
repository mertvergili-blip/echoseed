import type { Genome } from "../sim/types";
import type { CreatureState } from "../sim/save";

export type CreatureMood =
  | "scared"
  | "sleeping"
  | "excited"
  | "hungry"
  | "tired"
  | "lonely"
  | "curious"
  | "happy"
  | "neutral";

export type CreatureActivity = "idle" | "wander" | "play" | "sleep" | "follow" | "eat" | "flee" | "returning";

export type CreatureAction = "feed" | "pet" | "sleep" | null;

const MOOD_TRANSITION_SECONDS = 0.45;
const RETURN_DURATION = 0.9;

/**
 * Standalone behavioral model for the ascended desktop creature. Its needs
 * (hunger, energy, trust, curiosity, mood) evolve over real time and its
 * behaviour is modulated by its inherited genome. No OS spying — only the
 * clock, in-app interactions, and the cursor's position *while it's already
 * over this window* drive it.
 *
 * Everything in this file that isn't `state` (the persisted CreatureState)
 * is transient/derived — mood blending, cursor awareness, action animation
 * timers, the return-to-terrarium wind-down — so none of it needs a save
 * schema change; a freshly loaded creature just starts these at rest.
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

  // ---- Mood blending (for smooth visual transitions, not for logic) ------
  private prevMood: CreatureMood = "neutral";
  private currentMood: CreatureMood = "neutral";
  /** 0 = fully prevMood, 1 = fully currentMood. Renderer lerps between the
   * two moods' visual profiles using this instead of hard-cutting. */
  moodBlend = 1;

  // ---- Cursor awareness (only ever the *local* cursor position while it's
  // over this window — see creature.tsx's pointermove handler; there is no
  // global mouse/keyboard hook here). ------------------------------------
  private cursorX: number | null = null;
  private cursorY: number | null = null;
  private cursorSpeed = 0;
  scaredTimer = 0;
  excitedTimer = 0;

  // ---- Per-action animation (layered on top of `activity`) --------------
  lastAction: CreatureAction = null;
  actionAnim = 0;
  /** Set briefly when waking from sleep, for an eye-opening animation. */
  wakeAnim = 0;
  /** Occasional idle flourish (stretch/look-around) unrelated to needs. */
  quirkAnim = 0;

  // ---- Return-to-terrarium wind-down --------------------------------
  isReturning = false;
  returnProgress = 0;

  constructor(genome: Genome, state: CreatureState) {
    this.genome = genome;
    this.state = state;
  }

  /** Discrete mood used for behavior decisions. See `visualMoodBlend()` for
   * the smoothed version renderers should use for appearance. */
  get mood(): CreatureMood {
    const s = this.state;
    if (this.scaredTimer > 0) return "scared";
    if (this.activity === "sleep") return "sleeping";
    if (this.excitedTimer > 0) return "excited";
    if (s.hunger > 0.7) return "hungry";
    if (s.energy < 0.3) return "tired";
    if (this.idleSeconds > 90 && s.trust < 0.55) return "lonely";
    if (s.curiosity > 0.65 || this.activity === "follow") return "curious";
    if (s.mood > 0.65) return "happy";
    return "neutral";
  }

  /** The animation currently playing for the last player-triggered action,
   * or null once it's finished. Exposed for the debug panel and tests. */
  get activeAnimation(): string | null {
    if (this.isReturning) return "returning";
    if (this.actionAnim > 0 && this.lastAction) return this.lastAction;
    if (this.wakeAnim > 0) return "waking";
    if (this.quirkAnim > 0) return "quirk";
    return null;
  }

  isNight(): boolean {
    const h = new Date().getHours();
    return h >= 22 || h < 7;
  }

  /** Feed: reduces hunger, boosts mood & trust. */
  feed() {
    const before = this.state.hunger;
    this.state.hunger = Math.max(0, this.state.hunger - 0.4);
    this.state.energy = Math.min(1, this.state.energy + 0.15);
    this.state.mood = Math.min(1, this.state.mood + 0.2);
    this.state.trust = Math.min(1, this.state.trust + 0.05);
    this.state.lastInteractionTick = Date.now();
    this.idleSeconds = 0;
    this.activity = "eat";
    this.activityTimer = 3;
    this.lastAction = "feed";
    this.actionAnim = 1.4;
    if (before - this.state.hunger > 0.15) this.excitedTimer = 2.2;
    return before - this.state.hunger;
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
    this.lastAction = "pet";
    this.actionAnim = 1.2;
    this.excitedTimer = 1.8;
  }

  /** Put to sleep manually. */
  sleep() {
    this.activity = "sleep";
    this.activityTimer = 8;
    this.state.lastInteractionTick = Date.now();
    this.lastAction = "sleep";
    this.actionAnim = 0.6;
  }

  /** Begin the return-to-terrarium wind-down. The caller (creature.tsx)
   * should wait for `returnProgress >= 1` before actually closing the
   * window / navigating away, so the dissolve animation gets to play. */
  beginReturn() {
    this.isReturning = true;
    this.returnProgress = 0;
    this.activity = "returning";
  }

  /** Update the last-known cursor position, in window-local [0,1] space.
   * Pass null when the cursor isn't over this window. Called once per
   * rendered frame from creature.tsx so cursor speed can be derived from
   * the frame's own dt instead of needing separate timestamp bookkeeping. */
  private setCursor(nx: number | null, ny: number | null, dt: number) {
    if (nx == null || ny == null) {
      this.cursorX = null;
      this.cursorY = null;
      this.cursorSpeed = 0;
      return;
    }
    if (this.cursorX != null && this.cursorY != null && dt > 0) {
      const dx = nx - this.cursorX;
      const dy = ny - this.cursorY;
      this.cursorSpeed = Math.sqrt(dx * dx + dy * dy) / dt;
    }
    this.cursorX = nx;
    this.cursorY = ny;
  }

  /**
   * Advance the creature by dt seconds. `cursor` is the mouse position in
   * window-local [0,1] coordinates (or null if the cursor isn't over the
   * window this frame) — the only external signal this engine reacts to.
   */
  update(dt: number, cursor: { x: number; y: number } | null = null): void {
    const s = this.state;
    const g = this.genome;
    this.setCursor(cursor?.x ?? null, cursor?.y ?? null, dt);

    if (this.isReturning) {
      this.returnProgress = Math.min(1, this.returnProgress + dt / RETURN_DURATION);
      // Everything else keeps ticking gently (blink, bob) but behavior
      // selection/movement stop — the creature is winding down, not living.
      this.blink += dt;
      this.advanceMoodBlend(dt);
      return;
    }

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

    // Timed transient states.
    if (this.scaredTimer > 0) this.scaredTimer = Math.max(0, this.scaredTimer - dt);
    if (this.excitedTimer > 0) this.excitedTimer = Math.max(0, this.excitedTimer - dt);
    if (this.actionAnim > 0) this.actionAnim = Math.max(0, this.actionAnim - dt);
    if (this.wakeAnim > 0) this.wakeAnim = Math.max(0, this.wakeAnim - dt);
    if (this.quirkAnim > 0) this.quirkAnim = Math.max(0, this.quirkAnim - dt);

    // Fear-driven scare: cursor closing in fast while it's already near.
    if (this.cursorX != null && this.cursorY != null && g.fear > 0.45) {
      const dx = this.cursorX - this.x;
      const dy = this.cursorY - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (this.cursorSpeed > 1.1 && dist < 0.32) {
        this.scaredTimer = 1.4;
        this.activity = "flee";
        this.activityTimer = 1.2;
      }
    }

    const prevActivity = this.activity;

    // Behaviour selection.
    this.activityTimer -= dt;
    if (this.activityTimer <= 0 && this.activity !== "flee") this.chooseActivity();

    if (prevActivity === "sleep" && this.activity !== "sleep") this.wakeAnim = 0.6;

    // Rare idle flourish (stretch/look-around), independent of the main
    // activity state machine — purely cosmetic, doesn't move the creature.
    if (this.idleSeconds > 40 && this.quirkAnim <= 0 && this.activity === "idle") {
      if (Math.random() < dt * 0.03) this.quirkAnim = 1.6;
    }

    this.move(dt);
    this.updateMoodTarget();
    this.advanceMoodBlend(dt);
  }

  private updateMoodTarget() {
    const next = this.mood;
    if (next !== this.currentMood) {
      this.prevMood = this.currentMood;
      this.currentMood = next;
      this.moodBlend = 0;
    }
  }

  private advanceMoodBlend(dt: number) {
    if (this.moodBlend < 1) this.moodBlend = Math.min(1, this.moodBlend + dt / MOOD_TRANSITION_SECONDS);
  }

  /** The two moods and blend factor a renderer should interpolate between
   * for appearance — smoother than hard-switching on `mood` every frame. */
  visualMoodBlend(): { from: CreatureMood; to: CreatureMood; t: number } {
    return { from: this.prevMood, to: this.currentMood, t: this.moodBlend };
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
    // Tired-but-awake: seek a resting corner before actually sleeping.
    if (s.energy < 0.35 && g.sleepTendency > 0.25 && this.activity !== "wander") {
      this.activity = "wander";
      this.activityTimer = rand(2, 4);
      this.wanderTarget = pickCorner();
      return;
    }
    // Self-directed idle behaviours when alone for a while.
    const lonely = this.idleSeconds > 60;
    const roll = Math.random();
    if (this.activity === "sleep" && s.energy < 0.7) {
      this.activityTimer = rand(3, 6);
      return; // keep sleeping until rested
    }
    // Curious/sociable creatures drift toward a cursor that's present.
    if (
      this.cursorX != null &&
      this.cursorY != null &&
      roll < 0.1 + g.curiosity * 0.2 + g.sociability * 0.15
    ) {
      this.activity = "follow";
      this.activityTimer = rand(1.5, 3.5);
      return;
    }
    if (roll < 0.15 + g.curiosity * 0.2 && (lonely || s.curiosity > 0.5)) {
      this.activity = "play";
      this.activityTimer = rand(2, 5);
    } else if (roll < 0.55 + g.movementSpeed * 0.15) {
      this.activity = "wander";
      this.activityTimer = rand(3, 7);
      this.wanderTarget = { x: rand(0.2, 0.8), y: rand(0.3, 0.75) };
    } else {
      this.activity = "idle";
      this.activityTimer = rand(2, 5);
    }
  }

  private move(dt: number) {
    const g = this.genome;
    // Hunger makes movement slower/more restless; fear-fleeing is fast.
    const hungerSlow = 1 - this.state.hunger * 0.35;
    let speed = (0.15 + g.movementSpeed * 0.25) * dt * hungerSlow;

    let tx = this.x;
    let ty = this.y;

    switch (this.activity) {
      case "flee": {
        speed = (0.35 + g.movementSpeed * 0.35) * (1 + g.fear * 0.6) * dt;
        if (this.cursorX != null && this.cursorY != null) {
          const dx = this.x - this.cursorX;
          const dy = this.y - this.cursorY;
          const d = Math.max(0.05, Math.sqrt(dx * dx + dy * dy));
          tx = clamp01(this.x + (dx / d) * 0.5);
          ty = clamp01(this.y + (dy / d) * 0.5);
        }
        break;
      }
      case "follow":
        if (this.cursorX != null && this.cursorY != null) {
          // Approach but keep a small respectful distance, not right on top.
          const dx = this.cursorX - this.x;
          const dy = this.cursorY - this.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const keepOut = 0.1;
          tx = d > keepOut ? this.x + dx * 0.6 : this.x;
          ty = d > keepOut ? this.y + dy * 0.6 : this.y;
        } else {
          tx = this.wanderTarget.x;
          ty = this.wanderTarget.y;
        }
        break;
      case "wander":
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
      case "returning":
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
function pickCorner(): { x: number; y: number } {
  const corners = [
    { x: 0.15, y: 0.2 },
    { x: 0.85, y: 0.2 },
    { x: 0.15, y: 0.8 },
    { x: 0.85, y: 0.8 },
  ];
  return corners[Math.floor(Math.random() * corners.length)];
}
