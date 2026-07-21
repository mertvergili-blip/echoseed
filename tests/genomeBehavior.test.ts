import { describe, it, expect } from "vitest";
import { World } from "../src/sim/world";
import { Rng } from "../src/sim/rng";
import { randomGenome } from "../src/sim/genome";
import { CONFIG } from "../src/sim/config";
import type { Genome, Organism, Species } from "../src/sim/types";

/**
 * These tests prove that genome traits are not decorative — each one
 * produces a measurable, reproducible difference in movement, target
 * selection, survival, energy use, or reproduction, mediated entirely by the
 * utility-AI in World. Every test isolates a single trait by cloning a base
 * genome and overriding only the trait under study, so any observed
 * difference is attributable to that gene alone.
 */

function twin(base: Genome, overrides: Partial<Genome>): Genome {
  return { ...base, ...overrides };
}

function baseGenome(species: Species): Genome {
  return randomGenome(new Rng("behavior-base-" + species), species);
}

function emptyWorld(seed: string): World {
  const w = new World(seed);
  for (const o of w.organisms) w.kill(o, "clear-for-test");
  return w;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("genome-driven behavior: fear", () => {
  // Each fear level runs in its own isolated world (a single herbivore, no
  // other same-species organism) so flocking cohesion cannot pull the pair
  // back toward each other — and incidentally back toward the threat sitting
  // between them — which would confound a shared-world comparison.
  function runFearTrial(fear: number): number[] {
    const w = emptyWorld(`trait-fear-${fear}`);
    const predatorGenome = twin(baseGenome("predator"), { movementSpeed: 0, aggression: 0 });
    const predator = w.spawn("predator", predatorGenome, { x: 600, y: 400 }, 0)!;
    const herb = w.spawn(
      "herbivore",
      twin(baseGenome("herbivore"), { fear, visionRadius: 140 }),
      { x: 660, y: 400 },
      0,
    )!;
    herb.energy = herb.maxEnergy;

    const dists: number[] = [];
    for (let i = 0; i < 400; i++) {
      herb.energy = Math.max(herb.energy, herb.maxEnergy * 0.9);
      w.step();
      if (i > 150) dists.push(dist(herb.pos, predator.pos));
    }
    return dists;
  }

  it("high-fear herbivores keep more distance from a visible predator than low-fear herbivores", () => {
    const timidDists = runFearTrial(0.95);
    const boldDists = runFearTrial(0.05);
    const avgTimid = timidDists.reduce((a, b) => a + b, 0) / timidDists.length;
    const avgBold = boldDists.reduce((a, b) => a + b, 0) / boldDists.length;

    expect(avgTimid).toBeGreaterThan(avgBold * 1.15);
  });

  it("high-fear herbivores flee at a faster instantaneous speed than low-fear herbivores", () => {
    const w = emptyWorld("trait-fear-speed");
    const predatorGenome = twin(baseGenome("predator"), { movementSpeed: 0, aggression: 0 });
    w.spawn("predator", predatorGenome, { x: 600, y: 400 }, 0)!;
    const base = baseGenome("herbivore");
    const timid = w.spawn(
      "herbivore",
      twin(base, { fear: 0.95, visionRadius: 140 }),
      { x: 650, y: 400 },
      0,
    )!;
    const bold = w.spawn(
      "herbivore",
      twin(base, { fear: 0.05, visionRadius: 140 }),
      { x: 550, y: 400 },
      0,
    )!;
    timid.energy = timid.maxEnergy;
    bold.energy = bold.maxEnergy;
    w.step();
    expect(timid.action).toBe("flee");
    expect(bold.action).toBe("flee");
    const timidSpeed = Math.hypot(timid.vel.x, timid.vel.y);
    const boldSpeed = Math.hypot(bold.vel.x, bold.vel.y);
    expect(timidSpeed).toBeGreaterThan(boldSpeed);
  });
});

describe("genome-driven behavior: aggression", () => {
  it("high-aggression predators close distance on prey faster than low-aggression predators", () => {
    const w = emptyWorld("trait-aggression");
    const base = baseGenome("predator");
    const timid = w.spawn(
      "predator",
      twin(base, { aggression: 0.05, movementSpeed: 1.2, visionRadius: 140 }),
      { x: 200, y: 200 },
      0,
    )!;
    const fierce = w.spawn(
      "predator",
      twin(base, { aggression: 0.95, movementSpeed: 1.2, visionRadius: 140 }),
      { x: 800, y: 200 },
      0,
    )!;
    timid.energy = timid.maxEnergy * 0.5;
    fierce.energy = fierce.maxEnergy * 0.5;

    const preyBase = baseGenome("herbivore");
    // Stationary, effectively unkillable prey: the trial measures pursuit
    // behaviour (how aggressively the predator closes distance), not kill
    // outcome — if both predators eventually land a kill, "distance closed"
    // collapses to the same start-to-zero value for both regardless of how
    // fast either one got there, hiding the very difference under test.
    const preyNearTimid = w.spawn(
      "herbivore",
      twin(preyBase, { movementSpeed: 0, fear: 0 }),
      { x: 320, y: 200 },
      0,
    )!;
    const preyNearFierce = w.spawn(
      "herbivore",
      twin(preyBase, { movementSpeed: 0, fear: 0 }),
      { x: 920, y: 200 },
      0,
    )!;
    preyNearTimid.maxHealth = 1e6;
    preyNearTimid.health = 1e6;
    preyNearFierce.maxHealth = 1e6;
    preyNearFierce.health = 1e6;

    // Measure the approach phase only: once a predator reaches attack range
    // it orbits there regardless of aggression (attack still seeks the prey),
    // which would wash out the distinction if averaged over the whole trial.
    // So we look at how many ticks each predator takes to first close to a
    // threshold distance — the more aggressive one should get there sooner.
    const threshold = 60;
    let timidArrival = -1;
    let fierceArrival = -1;
    for (let i = 0; i < 150; i++) {
      if (timid.energy < timid.maxEnergy * 0.3) timid.energy = timid.maxEnergy * 0.5;
      if (fierce.energy < fierce.maxEnergy * 0.3) fierce.energy = fierce.maxEnergy * 0.5;
      w.step();
      if (timidArrival < 0 && dist(timid.pos, preyNearTimid.pos) <= threshold) timidArrival = i;
      if (fierceArrival < 0 && dist(fierce.pos, preyNearFierce.pos) <= threshold) fierceArrival = i;
    }

    expect(fierceArrival).toBeGreaterThanOrEqual(0);
    const effectiveTimid = timidArrival < 0 ? Infinity : timidArrival;
    expect(fierceArrival).toBeLessThan(effectiveTimid);
  });
});

describe("genome-driven behavior: curiosity", () => {
  it("high-curiosity organisms investigate a remembered food site more than low-curiosity ones", () => {
    const w = emptyWorld("trait-curiosity");
    const base = baseGenome("herbivore");
    const curious = w.spawn(
      "herbivore",
      twin(base, { curiosity: 0.95, fear: 0.1 }),
      { x: 400, y: 400 },
      0,
    )!;
    const incurious = w.spawn(
      "herbivore",
      twin(base, { curiosity: 0.02, fear: 0.1 }),
      { x: 700, y: 400 },
      0,
    )!;
    // Give both a memory of a food site with nothing currently visible there
    // (no live plant), so "investigate" is a genuine curiosity-only choice.
    curious.memory.lastFoodPos = { x: 400, y: 250 };
    curious.memory.lastFoodTick = 0;
    incurious.memory.lastFoodPos = { x: 700, y: 250 };
    incurious.memory.lastFoodTick = 0;
    curious.energy = curious.maxEnergy; // fed, so hunger doesn't force seekFood/rest
    incurious.energy = incurious.maxEnergy;

    let curiousInvestigate = 0;
    let incuriousInvestigate = 0;
    for (let i = 0; i < CONFIG.memoryDecayTicks - 10; i++) {
      curious.energy = curious.maxEnergy;
      incurious.energy = incurious.maxEnergy;
      w.step();
      if (curious.action === "investigate") curiousInvestigate++;
      if (incurious.action === "investigate") incuriousInvestigate++;
    }

    expect(curiousInvestigate).toBeGreaterThan(incuriousInvestigate);
  });
});

describe("genome-driven behavior: sociability", () => {
  // Cohesion is vision-limited (each organism steers toward same-species
  // neighbours it can actually see), so a small group scattered wider than
  // one vision radius can fragment into several tight sub-clusters that then
  // drift apart from each other. That's realistic local flocking, but it
  // means "distance to the whole group's single centroid" is the wrong
  // metric — it penalizes multi-cluster formation even when every individual
  // is, correctly, staying close to its nearest companions. Average
  // nearest-neighbour distance measures clustering without that confound.
  function avgNearestNeighbor(group: Organism[]): number {
    let sum = 0;
    for (const o of group) {
      let best = Infinity;
      for (const p of group) {
        if (p === o) continue;
        const d = dist(o.pos, p.pos);
        if (d < best) best = d;
      }
      sum += best;
    }
    return sum / group.length;
  }

  function runGroup(sociability: number, label: string): number {
    const w = emptyWorld("trait-sociability-" + label);
    const base = baseGenome("herbivore");
    const group: Organism[] = [];
    const rng = new Rng("sociability-positions");
    // sleepTendency: 0 keeps them in the wander branch (where cohesion lives)
    // instead of asleep — the test world starts near tick 0, which is night.
    for (let i = 0; i < 6; i++) {
      const pos = { x: rng.range(100, 500), y: rng.range(100, 400) };
      group.push(w.spawn("herbivore", twin(base, { sociability, fear: 0, sleepTendency: 0 }), pos, 0)!);
    }
    for (const o of group) o.energy = o.maxEnergy;

    const samples: number[] = [];
    for (let i = 0; i < 1200; i++) {
      for (const o of group) if (o.alive) o.energy = Math.max(o.energy, o.maxEnergy * 0.8);
      w.step();
      // Sample the back half once behaviour has reached a steady state.
      if (i > 600) samples.push(avgNearestNeighbor(group.filter((o) => o.alive)));
    }
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }

  it("high-sociability herbivores keep closer nearest-neighbour distances than low-sociability ones", () => {
    const socialNN = runGroup(0.95, "social");
    const looseNN = runGroup(0.02, "loose");
    expect(socialNN).toBeLessThan(looseNN * 0.6);
  });
});

describe("genome-driven behavior: metabolism", () => {
  it("fast metabolism burns energy strictly faster than slow metabolism, all else equal", () => {
    const w = emptyWorld("trait-metabolism");
    const base = baseGenome("herbivore");
    // Zero vision so neither perceives food/threats — isolates pure metabolic
    // + baseline-wander movement cost, both of which scale with metabolism.
    const slow = w.spawn(
      "herbivore",
      twin(base, { metabolism: 0.5, visionRadius: 0 }),
      { x: 300, y: 300 },
      0,
    )!;
    const fast = w.spawn(
      "herbivore",
      twin(base, { metabolism: 2.0, visionRadius: 0 }),
      { x: 700, y: 300 },
      0,
    )!;
    slow.energy = slow.maxEnergy;
    fast.energy = fast.maxEnergy;
    const slowStart = slow.energy;
    const fastStart = fast.energy;

    for (let i = 0; i < 200; i++) w.step();

    const slowDrain = slowStart - slow.energy;
    const fastDrain = fastStart - fast.energy;
    expect(fastDrain).toBeGreaterThan(slowDrain * 1.5);
  });
});

describe("genome-driven behavior: vision radius", () => {
  it("large vision detects and reacts to distant food sooner than small vision", () => {
    const w = emptyWorld("trait-vision");
    const base = baseGenome("herbivore");
    const farSighted = w.spawn(
      "herbivore",
      twin(base, { visionRadius: 150, movementSpeed: 0 }),
      { x: 200, y: 400 },
      0,
    )!;
    const nearSighted = w.spawn(
      "herbivore",
      twin(base, { visionRadius: 30, movementSpeed: 0 }),
      { x: 600, y: 400 },
      0,
    )!;
    farSighted.energy = farSighted.maxEnergy * 0.6;
    nearSighted.energy = nearSighted.maxEnergy * 0.6;

    // Distant plant: within far-sighted's vision (150) but outside near-sighted's (30).
    w.spawn("plant", twin(baseGenome("plant"), {}), { x: 290, y: 400 }, 0)!.energy =
      CONFIG.plantMaxEnergy;
    w.spawn("plant", twin(baseGenome("plant"), {}), { x: 690, y: 400 }, 0)!.energy =
      CONFIG.plantMaxEnergy;

    let farReactedTick = -1;
    let nearReactedTick = -1;
    for (let i = 0; i < 60; i++) {
      w.step();
      if (farReactedTick < 0 && farSighted.action === "seekFood") farReactedTick = i;
      if (nearReactedTick < 0 && nearSighted.action === "seekFood") nearReactedTick = i;
    }

    expect(farReactedTick).toBeGreaterThanOrEqual(0);
    // Near-sighted either reacts much later, or never within the window
    // (represented as -1, which is "later" than any real tick).
    const effectiveNear = nearReactedTick < 0 ? Infinity : nearReactedTick;
    expect(effectiveNear).toBeGreaterThan(farReactedTick);
  });
});

describe("genome-driven behavior: sleep tendency", () => {
  it("high sleep-tendency organisms sleep far more at night than low sleep-tendency ones", () => {
    const w = emptyWorld("trait-sleep");
    // Day cycle is phase-shifted (tick 0 = daylight); tick 1080 lands at
    // timeOfDay ~0.85 and stays >0.78 (night) for the following 300 ticks.
    w.tick = 1079;
    const base = baseGenome("herbivore");
    const sleepy = w.spawn(
      "herbivore",
      twin(base, { sleepTendency: 0.95, fear: 0, visionRadius: 0 }),
      { x: 300, y: 300 },
      0,
    )!;
    const wakeful = w.spawn(
      "herbivore",
      twin(base, { sleepTendency: 0.02, fear: 0, visionRadius: 0 }),
      { x: 700, y: 300 },
      0,
    )!;
    sleepy.energy = sleepy.maxEnergy * 0.8;
    wakeful.energy = wakeful.maxEnergy * 0.8;

    let sleepyTicks = 0;
    let wakefulTicks = 0;
    for (let i = 0; i < 300; i++) {
      sleepy.energy = Math.max(sleepy.energy, sleepy.maxEnergy * 0.5);
      wakeful.energy = Math.max(wakeful.energy, wakeful.maxEnergy * 0.5);
      w.step();
      expect(w.env.timeOfDay < 0.22 || w.env.timeOfDay > 0.78).toBe(true); // stayed night
      if (sleepy.action === "sleep") sleepyTicks++;
      if (wakeful.action === "sleep") wakefulTicks++;
    }

    expect(sleepyTicks).toBeGreaterThan(wakefulTicks * 2);
  });
});

describe("genome-driven behavior: fertility & reproduction", () => {
  it("high-fertility organisms reproduce more often than low-fertility organisms under identical conditions", () => {
    const w = emptyWorld("trait-fertility");
    const baseA = baseGenome("herbivore");

    // Two isolated well-fed pairs: one high-fertility, one low-fertility.
    const fertileA = w.spawn(
      "herbivore",
      twin(baseA, { fertility: 0.98, sociability: 0.9 }),
      { x: 200, y: 200 },
      0,
    )!;
    const fertileB = w.spawn(
      "herbivore",
      twin(baseA, { fertility: 0.98, sociability: 0.9 }),
      { x: 216, y: 200 },
      0,
    )!;
    const sterileA = w.spawn(
      "herbivore",
      twin(baseA, { fertility: 0.02, sociability: 0.9 }),
      { x: 800, y: 200 },
      0,
    )!;
    const sterileB = w.spawn(
      "herbivore",
      twin(baseA, { fertility: 0.02, sociability: 0.9 }),
      { x: 816, y: 200 },
      0,
    )!;
    for (const o of [fertileA, fertileB, sterileA, sterileB]) {
      o.reproCooldown = 0;
    }

    let fertileBirths = 0;
    let sterileBirths = 0;
    for (let i = 0; i < 1500; i++) {
      fertileA.energy = fertileA.maxEnergy;
      fertileB.energy = fertileB.maxEnergy;
      sterileA.energy = sterileA.maxEnergy;
      sterileB.energy = sterileB.maxEnergy;
      const before = w.organisms.length;
      w.step();
      const after = w.organisms.length;
      if (after > before) {
        const newest = w.organisms[w.organisms.length - 1];
        if (newest.parentIds && (newest.parentIds[0] === fertileA.id || newest.parentIds[0] === fertileB.id)) {
          fertileBirths++;
        } else if (
          newest.parentIds &&
          (newest.parentIds[0] === sterileA.id || newest.parentIds[0] === sterileB.id)
        ) {
          sterileBirths++;
        }
      }
    }

    expect(fertileBirths).toBeGreaterThan(sterileBirths);
  });
});

describe("current action reflects real decisions, not a static label", () => {
  it("action changes over time as circumstances change (not stuck on one value)", () => {
    const w = emptyWorld("action-is-live");
    const o = w.spawn("herbivore", baseGenome("herbivore"), { x: 500, y: 400 }, 0)!;
    o.energy = o.maxEnergy * 0.5;
    const seen = new Set<string>();
    for (let i = 0; i < 800; i++) {
      w.step();
      seen.add(o.action);
      // Periodically starve and refeed to force different action regimes.
      if (i === 200) o.energy = 1;
      if (i === 400) {
        const plant = w.spawn("plant", baseGenome("plant"), { x: o.pos.x + 5, y: o.pos.y }, 0)!;
        plant.energy = CONFIG.plantMaxEnergy;
      }
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("action determines actual velocity/target, not just a cosmetic tag", () => {
    const w = emptyWorld("action-drives-motion");
    const predatorGenome = twin(baseGenome("predator"), { movementSpeed: 0 });
    // Predator sits east of the herbivore, so fleeing away must move it west.
    w.spawn("predator", predatorGenome, { x: 580, y: 400 }, 0)!;
    const herb = w.spawn(
      "herbivore",
      twin(baseGenome("herbivore"), { fear: 0.9, visionRadius: 140 }),
      { x: 540, y: 400 },
      0,
    )!;
    herb.energy = herb.maxEnergy;
    w.step();
    expect(herb.action).toBe("flee");
    // Fleeing from a threat directly east of it must produce a westward velocity component.
    expect(herb.vel.x).toBeLessThan(0);
  });
});
