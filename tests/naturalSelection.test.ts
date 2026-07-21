import { describe, it, expect } from "vitest";
import { World } from "../src/sim/world";
import { Rng } from "../src/sim/rng";
import { randomGenome } from "../src/sim/genome";
import type { Genome } from "../src/sim/types";

/**
 * Natural-selection controlled experiments. Each test drops two cohorts with
 * opposite trait values into the same sustained environmental pressure and
 * measures which cohort actually survives better — a direct fitness
 * comparison, not just a behavioral difference. This is a stronger claim
 * than "the trait changes behavior" (see genomeBehavior.test.ts): it proves
 * the behavior difference actually pays off (or costs) in survival.
 *
 * Methodology note: an earlier draft of this audit measured fitness by
 * averaging genome values across the *whole* living population under
 * intermittent pressure. That was too noisy — reproduction constantly mixes
 * newborns into the average, and short repeated weather events don't apply
 * sustained pressure — and produced an inconclusive/wrong-direction signal
 * even for mechanisms that turned out to work correctly. Isolating two
 * tagged cohorts under *sustained* pressure and tracking their survival
 * counts directly is far less noisy and is what these tests do.
 */

function twin(base: Genome, overrides: Partial<Genome>): Genome {
  return { ...base, ...overrides };
}

function seedPlants(w: World, rng: Rng, n: number, energyEach: number) {
  for (let i = 0; i < n; i++) {
    const p = w.spawn("plant", null, { x: rng.range(0, 1200), y: rng.range(0, 800) }, 0);
    if (p) p.energy = energyEach;
  }
}

function survivalCount(w: World, ids: Set<number>): number {
  let n = 0;
  for (const id of ids) {
    const o = w.getById(id);
    if (o && o.alive) n++;
  }
  return n;
}

function clearInitial(w: World) {
  for (const o of w.organisms) w.kill(o, "clear-for-test");
}

describe("natural selection: predation pressure favors fear", () => {
  it("high-fear herbivores outsurvive low-fear herbivores under sustained predation", () => {
    const w = new World("selection-predation");
    clearInitial(w);
    const base = randomGenome(new Rng("sel-pred-base"), "herbivore");
    const rng = new Rng("sel-pred-positions");
    const timidIds = new Set<number>();
    const boldIds = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const pos = { x: rng.range(0, 1200), y: rng.range(0, 800) };
      timidIds.add(w.spawn("herbivore", twin(base, { fear: 0.9 }), pos, 0)!.id);
    }
    for (let i = 0; i < 30; i++) {
      const pos = { x: rng.range(0, 1200), y: rng.range(0, 800) };
      boldIds.add(w.spawn("herbivore", twin(base, { fear: 0.1 }), pos, 0)!.id);
    }
    seedPlants(w, rng, 120, 50);
    for (let i = 0; i < 12; i++) {
      w.spawn("predator", randomGenome(new Rng("sel-pred-p" + i), "predator"), {
        x: rng.range(0, 1200),
        y: rng.range(0, 800),
      }, 0);
    }

    for (let i = 0; i < 2000; i++) {
      if (i % 400 === 0) {
        // Keep predation pressure sustained.
        while (w.countSpecies("predator") < 10) {
          w.spawn("predator", randomGenome(new Rng("sel-pred-refill" + i), "predator"), {
            x: rng.range(0, 1200),
            y: rng.range(0, 800),
          }, 0);
        }
      }
      w.step();
    }

    const timidLeft = survivalCount(w, timidIds);
    const boldLeft = survivalCount(w, boldIds);
    expect(timidLeft).toBeGreaterThan(boldLeft);
  });
});

describe("natural selection: sustained cold favors cold-adapted preferredTemp", () => {
  it("cold-adapted herbivores outsurvive heat-adapted herbivores in a permanent cold snap", () => {
    const w = new World("selection-cold");
    clearInitial(w);
    w.applyIntervention({ type: "cold", value: 100000 });
    const base = randomGenome(new Rng("sel-cold-base"), "herbivore");
    const rng = new Rng("sel-cold-positions");
    const coldAdaptedIds = new Set<number>();
    const heatAdaptedIds = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const pos = { x: rng.range(0, 1200), y: rng.range(0, 800) };
      coldAdaptedIds.add(w.spawn("herbivore", twin(base, { preferredTemp: 0.1 }), pos, 0)!.id);
    }
    for (let i = 0; i < 30; i++) {
      const pos = { x: rng.range(0, 1200), y: rng.range(0, 800) };
      heatAdaptedIds.add(w.spawn("herbivore", twin(base, { preferredTemp: 0.9 }), pos, 0)!.id);
    }
    seedPlants(w, rng, 150, 50);

    for (let i = 0; i < 2200; i++) w.step();

    const coldLeft = survivalCount(w, coldAdaptedIds);
    const heatLeft = survivalCount(w, heatAdaptedIds);
    expect(coldLeft).toBeGreaterThan(heatLeft);
  });
});

describe("natural selection: sustained heat favors heat-adapted preferredTemp", () => {
  it("heat-adapted herbivores outsurvive cold-adapted herbivores under permanent heat", () => {
    const w = new World("selection-heat");
    clearInitial(w);
    w.applyIntervention({ type: "setTemperature", value: 0.95 });
    const base = randomGenome(new Rng("sel-heat-base"), "herbivore");
    const rng = new Rng("sel-heat-positions");
    const coldAdaptedIds = new Set<number>();
    const heatAdaptedIds = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const pos = { x: rng.range(0, 1200), y: rng.range(0, 800) };
      coldAdaptedIds.add(w.spawn("herbivore", twin(base, { preferredTemp: 0.1 }), pos, 0)!.id);
    }
    for (let i = 0; i < 30; i++) {
      const pos = { x: rng.range(0, 1200), y: rng.range(0, 800) };
      heatAdaptedIds.add(w.spawn("herbivore", twin(base, { preferredTemp: 0.9 }), pos, 0)!.id);
    }
    seedPlants(w, rng, 150, 50);

    for (let i = 0; i < 2200; i++) w.step();

    const coldLeft = survivalCount(w, coldAdaptedIds);
    const heatLeft = survivalCount(w, heatAdaptedIds);
    expect(heatLeft).toBeGreaterThan(coldLeft);
  });

  it("proves no universal super-genome: cold and heat scenarios select opposite optima", () => {
    // This is the same pair of trials in miniature, just asserting the two
    // outcomes actually diverge in opposite directions rather than both
    // trending the same way (which would mean one preferredTemp value is
    // just globally superior regardless of environment).
    const runTrial = (weatherIv: { type: "cold" | "setTemperature"; value: number }) => {
      const w = new World("universal-genome-check-" + weatherIv.type);
      clearInitial(w);
      w.applyIntervention(weatherIv);
      const base = randomGenome(new Rng("ug-base"), "herbivore");
      const rng = new Rng("ug-positions");
      const coldIds = new Set<number>();
      const heatIds = new Set<number>();
      for (let i = 0; i < 25; i++) {
        coldIds.add(
          w.spawn("herbivore", twin(base, { preferredTemp: 0.1 }), { x: rng.range(0, 1200), y: rng.range(0, 800) }, 0)!.id,
        );
      }
      for (let i = 0; i < 25; i++) {
        heatIds.add(
          w.spawn("herbivore", twin(base, { preferredTemp: 0.9 }), { x: rng.range(0, 1200), y: rng.range(0, 800) }, 0)!.id,
        );
      }
      seedPlants(w, rng, 150, 50);
      for (let i = 0; i < 2000; i++) w.step();
      return survivalCount(w, coldIds) - survivalCount(w, heatIds);
    };

    const coldWorldAdvantage = runTrial({ type: "cold", value: 100000 });
    const heatWorldAdvantage = runTrial({ type: "setTemperature", value: 0.95 });

    // Cold-adapted should win under cold (positive advantage) and lose under
    // heat (negative advantage) — opposite signs proves context-dependent
    // fitness rather than a single trait value dominating everywhere.
    expect(coldWorldAdvantage).toBeGreaterThan(0);
    expect(heatWorldAdvantage).toBeLessThan(0);
  });
});

describe("natural selection: food scarcity favors low metabolism", () => {
  it("thrifty (low-metabolism) herbivores outsurvive wasteful (high-metabolism) ones under drought scarcity", () => {
    const w = new World("selection-scarcity");
    clearInitial(w);
    w.applyIntervention({ type: "drought", value: 100000 });
    const base = randomGenome(new Rng("sel-scarce-base"), "herbivore");
    const rng = new Rng("sel-scarce-positions");
    const thriftyIds = new Set<number>();
    const wastefulIds = new Set<number>();
    for (let i = 0; i < 30; i++) {
      thriftyIds.add(
        w.spawn("herbivore", twin(base, { metabolism: 0.55 }), { x: rng.range(0, 1200), y: rng.range(0, 800) }, 0)!.id,
      );
    }
    for (let i = 0; i < 30; i++) {
      wastefulIds.add(
        w.spawn("herbivore", twin(base, { metabolism: 1.9 }), { x: rng.range(0, 1200), y: rng.range(0, 800) }, 0)!.id,
      );
    }
    // Sparse food — scarcity is the point of the scenario.
    seedPlants(w, rng, 40, 40);

    for (let i = 0; i < 2200; i++) w.step();

    const thriftyLeft = survivalCount(w, thriftyIds);
    const wastefulLeft = survivalCount(w, wastefulIds);
    expect(thriftyLeft).toBeGreaterThan(wastefulLeft);
  });
});

describe("natural selection: predator-free environment removes fear's advantage", () => {
  it("without predators, high fear confers no survival benefit over low fear (and costs nothing catastrophic)", () => {
    const w = new World("selection-no-predator");
    clearInitial(w);
    const base = randomGenome(new Rng("sel-nopred-base"), "herbivore");
    const rng = new Rng("sel-nopred-positions");
    const timidIds = new Set<number>();
    const boldIds = new Set<number>();
    for (let i = 0; i < 30; i++) {
      timidIds.add(
        w.spawn("herbivore", twin(base, { fear: 0.9 }), { x: rng.range(0, 1200), y: rng.range(0, 800) }, 0)!.id,
      );
    }
    for (let i = 0; i < 30; i++) {
      boldIds.add(
        w.spawn("herbivore", twin(base, { fear: 0.1 }), { x: rng.range(0, 1200), y: rng.range(0, 800) }, 0)!.id,
      );
    }
    seedPlants(w, rng, 150, 50);

    for (let i = 0; i < 2000; i++) {
      // Predator-free: remove any that spawn/wander in.
      if (i % 100 === 0) {
        for (const o of w.organisms) if (o.alive && o.species === "predator") w.kill(o, "excluded");
      }
      w.step();
    }

    const timidLeft = survivalCount(w, timidIds);
    const boldLeft = survivalCount(w, boldIds);
    // Without predators, fear should not create a large survival gap in
    // either direction — it's neither strongly helpful nor catastrophic.
    const total = timidLeft + boldLeft;
    if (total > 0) {
      const imbalance = Math.abs(timidLeft - boldLeft) / total;
      expect(imbalance).toBeLessThan(0.6);
    }
  });
});
