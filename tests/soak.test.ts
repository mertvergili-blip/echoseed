import { describe, it, expect } from "vitest";
import { World } from "../src/sim/world";

/**
 * Headless long-run soak test. Runs many thousands of ticks with periodic
 * interventions and asserts the simulation never crashes, never produces
 * NaN, and never exceeds hard caps.
 */
describe("soak: long simulation", () => {
  it("runs 20000 ticks without crashing or producing NaN", () => {
    const w = new World("soak-marathon");
    let maxPop = 0;

    for (let i = 0; i < 20000; i++) {
      // Periodic ecological pressure to keep dynamics interesting.
      if (i % 1500 === 0 && i > 0) {
        w.applyIntervention({ type: "addFood", value: 8 });
      }
      if (i % 4000 === 2000) {
        w.applyIntervention({ type: "drought", value: 500 });
      }
      if (i % 4000 === 0 && i > 0) {
        w.applyIntervention({ type: "rain", value: 500 });
      }
      if (i % 6000 === 3000) {
        w.applyIntervention({ type: "addPredator" });
      }

      w.step();
      maxPop = Math.max(maxPop, w.organisms.length);

      // Spot check invariants every 500 ticks (cheap enough).
      if (i % 500 === 0) {
        for (const o of w.organisms) {
          if (!o.alive) continue;
          if (
            !Number.isFinite(o.pos.x) ||
            !Number.isFinite(o.pos.y) ||
            !Number.isFinite(o.energy) ||
            !Number.isFinite(o.health)
          ) {
            throw new Error(`Non-finite organism at tick ${i}, id ${o.id}`);
          }
        }
        expect(Number.isFinite(w.env.temperature)).toBe(true);
        expect(Number.isFinite(w.env.moisture)).toBe(true);
      }
    }

    expect(w.tick).toBe(20000);
    // Hard cap must never be breached.
    expect(maxPop).toBeLessThanOrEqual(700);
    // History should have been sampled and bounded.
    expect(w.history.length).toBeGreaterThan(0);
    expect(w.history.length).toBeLessThanOrEqual(600);
  }, 120000);

  it("population recovers or persists — does not instantly collapse to zero", () => {
    const w = new World("soak-stability");
    let sawLife = false;
    for (let i = 0; i < 8000; i++) {
      w.step();
      if (i > 100 && w.organisms.length > 0) sawLife = true;
    }
    expect(sawLife).toBe(true);
  }, 60000);
});
