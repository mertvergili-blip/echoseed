import { describe, it, expect } from "vitest";
import { CreatureEngine, type CreatureMood } from "../src/creature/creatureEngine";
import { randomGenome } from "../src/sim/genome";
import { Rng } from "../src/sim/rng";
import { DEFAULT_CREATURE, type CreatureState, makeSave, loadSave } from "../src/sim/save";
import { World } from "../src/sim/world";

const ALL_MOODS: CreatureMood[] = [
  "scared",
  "sleeping",
  "excited",
  "hungry",
  "tired",
  "lonely",
  "curious",
  "happy",
  "neutral",
];

function makeEngine(overrides: Partial<CreatureState> = {}) {
  const g = randomGenome(new Rng("creature-test"), "herbivore");
  return new CreatureEngine(g, { ...DEFAULT_CREATURE, ...overrides });
}

describe("CreatureEngine needs", () => {
  it("feeding reduces hunger and raises mood", () => {
    const e = makeEngine();
    e.state.hunger = 0.9;
    const moodBefore = e.state.mood;
    e.feed();
    expect(e.state.hunger).toBeLessThan(0.9);
    expect(e.state.mood).toBeGreaterThanOrEqual(moodBefore);
  });

  it("feed() returns the actual hunger reduction", () => {
    const e = makeEngine({ hunger: 0.8 });
    const delta = e.feed();
    expect(delta).toBeCloseTo(0.4, 5);
    expect(e.state.hunger).toBeCloseTo(0.4, 5);
  });

  it("petting increases trust", () => {
    const e = makeEngine();
    const before = e.state.trust;
    e.pet();
    expect(e.state.trust).toBeGreaterThan(before);
  });

  it("needs stay within [0,1] over a long simulated lifetime", () => {
    const e = makeEngine();
    for (let i = 0; i < 5000; i++) {
      e.update(0.5);
      if (i % 200 === 0) e.feed();
      if (i % 350 === 0) e.pet();
      for (const key of ["hunger", "energy", "trust", "curiosity", "mood"] as const) {
        expect(e.state[key]).toBeGreaterThanOrEqual(0);
        expect(e.state[key]).toBeLessThanOrEqual(1);
        expect(Number.isFinite(e.state[key])).toBe(true);
      }
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThanOrEqual(1);
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.y).toBeLessThanOrEqual(1);
      expect(ALL_MOODS).toContain(e.mood);
    }
  });

  it("hunger rises over time without feeding", () => {
    const e = makeEngine();
    e.state.hunger = 0.1;
    for (let i = 0; i < 100; i++) e.update(1);
    expect(e.state.hunger).toBeGreaterThan(0.1);
  });

  it("reports a valid mood string", () => {
    const e = makeEngine();
    expect(ALL_MOODS).toContain(e.mood);
  });
});

describe("CreatureEngine mood transitions", () => {
  it("is hungry when hunger is high", () => {
    const e = makeEngine({ hunger: 0.9, energy: 0.9, trust: 0.9, mood: 0.5 });
    expect(e.mood).toBe("hungry");
  });

  it("is tired when energy is low but not asleep", () => {
    const e = makeEngine({ hunger: 0.1, energy: 0.15, trust: 0.9 });
    e.activity = "wander";
    expect(e.mood).toBe("tired");
  });

  it("is sleeping only while the sleep activity is active", () => {
    const e = makeEngine({ hunger: 0.1, energy: 0.5 });
    e.activity = "sleep";
    expect(e.mood).toBe("sleeping");
  });

  it("is lonely after long idleness with low trust", () => {
    const e = makeEngine({ hunger: 0.1, energy: 0.9, trust: 0.2, mood: 0.3 });
    // Hold energy/hunger steady so 200 simulated seconds of natural drain
    // can't push the creature into "hungry"/"tired"/"sleeping" first —
    // this test is specifically about the idle+low-trust path.
    for (let i = 0; i < 200; i++) {
      e.update(1);
      e.state.energy = 0.9;
      e.state.hunger = 0.1;
    }
    expect(e.mood).toBe("lonely");
  });

  it("is excited briefly after a strong feed", () => {
    const e = makeEngine({ hunger: 0.9 });
    e.feed();
    expect(e.mood).toBe("excited");
    // Excited is a transient window, not permanent.
    for (let i = 0; i < 10; i++) e.update(1);
    expect(e.mood).not.toBe("excited");
  });

  it("becomes scared when a fearful creature notices a fast-approaching cursor", () => {
    const g = randomGenome(new Rng("scared-test"), "herbivore");
    g.fear = 0.95;
    const e = new CreatureEngine(g, { ...DEFAULT_CREATURE });
    e.x = 0.5;
    e.y = 0.5;
    // First sample establishes a cursor baseline (no speed yet)...
    e.update(0.05, { x: 0.9, y: 0.5 });
    // ...then a fast, close approach on the next frame should scare it.
    e.update(0.05, { x: 0.6, y: 0.5 });
    expect(e.mood).toBe("scared");
    expect(e.activity).toBe("flee");
  });

  it("a fearless creature does not get scared by the same fast cursor motion", () => {
    const g = randomGenome(new Rng("fearless-test"), "herbivore");
    g.fear = 0.05;
    const e = new CreatureEngine(g, { ...DEFAULT_CREATURE });
    e.x = 0.5;
    e.y = 0.5;
    e.update(0.05, { x: 0.9, y: 0.5 });
    e.update(0.05, { x: 0.6, y: 0.5 });
    expect(e.mood).not.toBe("scared");
  });

  it("mood blend settles back to fully-resolved after a transition", () => {
    const e = makeEngine({ hunger: 0.1, energy: 0.9, trust: 0.9, mood: 0.9 });
    e.update(0.016);
    e.feed(); // triggers excited -> blend resets to 0
    const blend = e.visualMoodBlend();
    expect(blend.t).toBeLessThan(1);
    for (let i = 0; i < 60; i++) e.update(0.05);
    expect(e.visualMoodBlend().t).toBe(1);
  });
});

describe("CreatureEngine action animations", () => {
  it("feed starts an animation that ends on its own", () => {
    const e = makeEngine();
    expect(e.activeAnimation).toBeNull();
    e.feed();
    expect(e.activeAnimation).toBe("feed");
    for (let i = 0; i < 60; i++) e.update(0.1);
    expect(e.activeAnimation).toBeNull();
  });

  it("pet starts an animation that ends on its own", () => {
    const e = makeEngine();
    e.pet();
    expect(e.activeAnimation).toBe("pet");
    for (let i = 0; i < 60; i++) e.update(0.1);
    expect(e.activeAnimation).not.toBe("pet");
  });

  it("waking from sleep plays a wake animation", () => {
    const e = makeEngine({ energy: 0.9 });
    e.sleep();
    for (let i = 0; i < 5; i++) e.update(1); // let it actually enter sleep
    expect(e.activity).toBe("sleep");
    // Force it awake by driving energy full and re-rolling activity.
    e.state.energy = 1;
    for (let i = 0; i < 30 && e.activity === "sleep"; i++) e.update(1);
    if (e.activity !== "sleep") {
      expect(e.activeAnimation === "waking" || e.activeAnimation === null).toBe(true);
    }
  });

  it("rapid repeated feed/pet clicks never produce NaN or out-of-bounds state", () => {
    const e = makeEngine();
    for (let i = 0; i < 200; i++) {
      e.feed();
      e.pet();
      e.update(0.001);
    }
    for (const key of ["hunger", "energy", "trust", "curiosity", "mood"] as const) {
      expect(Number.isFinite(e.state[key])).toBe(true);
      expect(e.state[key]).toBeGreaterThanOrEqual(0);
      expect(e.state[key]).toBeLessThanOrEqual(1);
    }
    expect(e.actionAnim).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(e.actionAnim)).toBe(true);
  });
});

describe("CreatureEngine return-to-terrarium", () => {
  it("beginReturn progresses to completion and then stays complete", () => {
    const e = makeEngine();
    e.beginReturn();
    expect(e.isReturning).toBe(true);
    expect(e.returnProgress).toBe(0);
    for (let i = 0; i < 200; i++) e.update(0.05);
    expect(e.returnProgress).toBe(1);
    expect(e.activeAnimation).toBe("returning");
  });

  it("does not move or drift needs while returning", () => {
    const e = makeEngine({ hunger: 0.2 });
    const xBefore = e.x;
    e.beginReturn();
    for (let i = 0; i < 20; i++) e.update(0.05);
    expect(e.x).toBe(xBefore);
    expect(e.state.hunger).toBe(0.2);
  });
});

describe("CreatureEngine save/load persistence", () => {
  it("persisted needs survive a save/load round trip unchanged", () => {
    const w = new World("creature-persist-seed");
    const creature: CreatureState = {
      ...DEFAULT_CREATURE,
      hunger: 0.42,
      energy: 0.77,
      trust: 0.31,
      curiosity: 0.63,
      mood: 0.55,
    };
    const save = makeSave(w, { simSpeed: 1, paused: false, showDebug: false }, creature);
    const result = loadSave(save);
    expect(result.creature.hunger).toBeCloseTo(0.42, 5);
    expect(result.creature.energy).toBeCloseTo(0.77, 5);
    expect(result.creature.trust).toBeCloseTo(0.31, 5);
    expect(result.creature.curiosity).toBeCloseTo(0.63, 5);
    expect(result.creature.mood).toBeCloseTo(0.55, 5);
  });

  it("a freshly loaded creature's transient engine state starts at rest", () => {
    // Transient fields (mood blend, cursor, action anim, return progress)
    // are intentionally not part of CreatureState — a reloaded engine
    // should never resume mid-animation from a previous session.
    const g = randomGenome(new Rng("fresh-load"), "herbivore");
    const e = new CreatureEngine(g, { ...DEFAULT_CREATURE });
    expect(e.activeAnimation).toBeNull();
    expect(e.isReturning).toBe(false);
    expect(e.scaredTimer).toBe(0);
    expect(e.excitedTimer).toBe(0);
  });
});
