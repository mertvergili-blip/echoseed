import { describe, it, expect } from "vitest";
import { CreatureEngine } from "../src/creature/creatureEngine";
import { randomGenome } from "../src/sim/genome";
import { Rng } from "../src/sim/rng";
import { DEFAULT_CREATURE } from "../src/sim/save";

function makeEngine() {
  const g = randomGenome(new Rng("creature-test"), "herbivore");
  return new CreatureEngine(g, { ...DEFAULT_CREATURE });
}

describe("CreatureEngine", () => {
  it("feeding reduces hunger and raises mood", () => {
    const e = makeEngine();
    e.state.hunger = 0.9;
    const moodBefore = e.state.mood;
    e.feed();
    expect(e.state.hunger).toBeLessThan(0.9);
    expect(e.state.mood).toBeGreaterThanOrEqual(moodBefore);
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
      for (const key of ["hunger", "energy", "trust", "curiosity", "mood"] as const) {
        expect(e.state[key]).toBeGreaterThanOrEqual(0);
        expect(e.state[key]).toBeLessThanOrEqual(1);
        expect(Number.isFinite(e.state[key])).toBe(true);
      }
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThanOrEqual(1);
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.y).toBeLessThanOrEqual(1);
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
    const moods = ["content", "happy", "curious", "hungry", "sleepy", "lonely"];
    expect(moods).toContain(e.mood);
  });
});
