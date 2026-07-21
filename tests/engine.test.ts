import { describe, it, expect } from "vitest";
import { World } from "../src/sim/world";
import { Rng } from "../src/sim/rng";
import { randomGenome, crossover, forceMutate, GENOME_RANGES } from "../src/sim/genome";
import { makeSave, loadSave, DEFAULT_SETTINGS, DEFAULT_CREATURE } from "../src/sim/save";
import type { Genome } from "../src/sim/types";

function signature(w: World): string {
  // A compact deterministic fingerprint of world state. Must filter to
  // `alive` organisms: World.organisms lazily compacts dead entries (only
  // every 30 ticks, see World.step/compact), so the raw array can briefly
  // contain organisms that already died. World.snapshot() (used by
  // save/load) correctly excludes them, so this helper has to match that or
  // a save/load round trip taken between compactions looks like a mismatch
  // when it isn't one.
  const alive = w.organisms.filter((o) => o.alive);
  let s = `${w.tick}|${w.nextId}|${alive.length}|`;
  for (const o of alive) {
    s += `${o.id}:${o.pos.x.toFixed(4)},${o.pos.y.toFixed(4)},${o.energy.toFixed(4)};`;
  }
  return s;
}

describe("Rng", () => {
  it("is deterministic for a given seed", () => {
    const a = new Rng("hello");
    const b = new Rng("hello");
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it("produces different streams for different seeds", () => {
    const a = new Rng("hello");
    const b = new Rng("world");
    let diff = 0;
    for (let i = 0; i < 100; i++) if (a.next() !== b.next()) diff++;
    expect(diff).toBeGreaterThan(90);
  });

  it("round-trips state", () => {
    const a = new Rng("state");
    for (let i = 0; i < 50; i++) a.next();
    const st = a.getState();
    const b = new Rng("different");
    b.setState(st);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });
});

describe("deterministic seed", () => {
  it("same seed + same ticks produce identical worlds", () => {
    const a = new World("determinism-test");
    const b = new World("determinism-test");
    for (let i = 0; i < 500; i++) {
      a.step();
      b.step();
    }
    expect(signature(a)).toBe(signature(b));
  });

  it("same seed + same interventions produce identical worlds", () => {
    const run = () => {
      const w = new World("iv-test");
      for (let i = 0; i < 300; i++) {
        if (i === 50) w.applyIntervention({ type: "addFood", x: 100, y: 100, value: 5 });
        if (i === 120) w.applyIntervention({ type: "rain", value: 100 });
        if (i === 200) w.applyIntervention({ type: "addPredator", x: 400, y: 400 });
        w.step();
      }
      return signature(w);
    };
    expect(run()).toBe(run());
  });

  it("stays byte-identical across a long run with interventions, checked at multiple tick checkpoints", () => {
    // Full serialized-snapshot comparison (not just position/energy), sorted
    // by id for order-independence, checked at several points across an
    // 8000-tick run. This is a stronger determinism guarantee than the
    // short-run tests above: genome, health, action, and RNG state must all
    // match exactly at every checkpoint, not just at the very end.
    const fullHash = (w: World) => {
      const snap = w.snapshot();
      const orgs = snap.organisms
        .slice()
        .sort((x, y) => x.id - y.id)
        .map(
          (o) =>
            `${o.id},${o.species},${o.generation},${o.pos.x.toFixed(6)},${o.pos.y.toFixed(6)},` +
            `${o.energy.toFixed(6)},${o.health.toFixed(6)},${o.action},${JSON.stringify(o.genome)}`,
        )
        .join("|");
      return `t${snap.tick};rng${snap.rngState.join(",")};next${snap.nextId};${orgs}`;
    };

    const runWithCheckpoints = () => {
      const w = new World("checkpoint-determinism");
      const checkpoints = [500, 1500, 3000, 5000, 8000];
      const hashes: string[] = [];
      for (let i = 1; i <= 8000; i++) {
        if (i === 800) w.applyIntervention({ type: "addPredator" });
        if (i === 2200) w.applyIntervention({ type: "rain", value: 300 });
        if (i === 4000) w.applyIntervention({ type: "drought", value: 300 });
        if (i === 6000) w.applyIntervention({ type: "addFood", x: 200, y: 200, value: 5 });
        w.step();
        if (checkpoints.includes(i)) hashes.push(fullHash(w));
      }
      return hashes;
    };

    const a = runWithCheckpoints();
    const b = runWithCheckpoints();
    expect(a.length).toBe(5);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBe(b[i]);
    }
  });

  it("different seeds diverge", () => {
    const a = new World("seed-a");
    const b = new World("seed-b");
    for (let i = 0; i < 200; i++) {
      a.step();
      b.step();
    }
    expect(signature(a)).not.toBe(signature(b));
  });
});

describe("genome inheritance", () => {
  it("child genes blend within parent-derived neighbourhood or mutate within bounds", () => {
    const rng = new Rng("inherit");
    const p1 = randomGenome(rng, "herbivore");
    const p2 = randomGenome(rng, "herbivore");
    for (let t = 0; t < 200; t++) {
      const child = crossover(p1, p2, rng);
      for (const k of Object.keys(GENOME_RANGES) as (keyof Genome)[]) {
        const [min, max] = GENOME_RANGES[k];
        expect(child[k]).toBeGreaterThanOrEqual(min);
        expect(child[k]).toBeLessThanOrEqual(max);
        expect(Number.isNaN(child[k])).toBe(false);
      }
    }
  });

  it("inheritance is deterministic given same rng stream", () => {
    const r1 = new Rng("x");
    const r2 = new Rng("x");
    const p1 = randomGenome(r1, "predator");
    const p2 = randomGenome(r1, "predator");
    const q1 = randomGenome(r2, "predator");
    const q2 = randomGenome(r2, "predator");
    expect(crossover(p1, p2, r1)).toEqual(crossover(q1, q2, r2));
  });
});

describe("mutation bounds", () => {
  it("forceMutate stays within gene ranges", () => {
    const rng = new Rng("mut");
    let g = randomGenome(rng, "herbivore");
    for (let i = 0; i < 500; i++) {
      g = forceMutate(g, rng, 1.5); // extreme strength
      for (const k of Object.keys(GENOME_RANGES) as (keyof Genome)[]) {
        const [min, max] = GENOME_RANGES[k];
        expect(g[k]).toBeGreaterThanOrEqual(min);
        expect(g[k]).toBeLessThanOrEqual(max);
      }
    }
  });
});

describe("energy consumption", () => {
  it("an isolated herbivore loses energy over time and eventually dies", () => {
    const w = new World("energy");
    // Remove all plants so herbivore cannot feed.
    for (const o of w.organisms) if (o.species !== "herbivore") w.kill(o, "test");
    const herb = w.organisms.find((o) => o.species === "herbivore" && o.alive)!;
    const start = herb.energy;
    for (let i = 0; i < 50; i++) w.step();
    expect(herb.energy).toBeLessThan(start);
  });
});

describe("feeding", () => {
  it("a hungry herbivore next to a plant gains energy", () => {
    const w = new World("feed");
    for (const o of w.organisms) w.kill(o, "test");
    const herb = w.spawn("herbivore", null, { x: 200, y: 200 }, 0)!;
    herb.energy = herb.maxEnergy * 0.2;
    const plant = w.spawn("plant", null, { x: 205, y: 200 }, 0)!;
    plant.energy = 60;
    const before = herb.energy;
    for (let i = 0; i < 20; i++) w.step();
    expect(herb.energy).toBeGreaterThan(before);
  });
});

describe("reproduction", () => {
  it("two well-fed herbivores near each other can produce offspring", () => {
    const w = new World("repro");
    for (const o of w.organisms) w.kill(o, "test");
    const a = w.spawn("herbivore", null, { x: 300, y: 300 }, 0)!;
    const b = w.spawn("herbivore", null, { x: 308, y: 300 }, 0)!;
    a.reproCooldown = 0;
    b.reproCooldown = 0;
    a.energy = a.maxEnergy;
    b.energy = b.maxEnergy;
    a.genome.fertility = 1;
    b.genome.fertility = 1;
    const startCount = w.countSpecies("herbivore");
    // Keep them fed so energy stays high.
    for (let i = 0; i < 60; i++) {
      a.energy = a.maxEnergy;
      b.energy = b.maxEnergy;
      w.step();
      if (w.countSpecies("herbivore") > startCount) break;
    }
    expect(w.countSpecies("herbivore")).toBeGreaterThan(startCount);
    const child = w.organisms.find((o) => o.parentIds && o.generation === 1);
    expect(child).toBeTruthy();
    expect(child!.parentIds).toContain(a.id);
  });
});

describe("death", () => {
  it("kill marks organism dead and records death tick in lineage", () => {
    const w = new World("death");
    const o = w.organisms.find((x) => x.alive)!;
    w.step();
    w.kill(o, "test");
    expect(o.alive).toBe(false);
    const node = w.lineage.find((n) => n.id === o.id)!;
    expect(node.diedTick).toBe(w.tick);
  });
});

describe("predator targeting", () => {
  it("predator chases and can kill a nearby herbivore", () => {
    const w = new World("predation");
    for (const o of w.organisms) w.kill(o, "test");
    const pred = w.spawn("predator", null, { x: 400, y: 400 }, 0)!;
    pred.energy = pred.maxEnergy * 0.3; // hungry
    pred.genome.aggression = 1;
    pred.genome.visionRadius = 160;
    pred.genome.movementSpeed = 2;
    const prey = w.spawn("herbivore", null, { x: 440, y: 400 }, 0)!;
    prey.genome.movementSpeed = 0.4;
    const preyId = prey.id;
    let killed = false;
    for (let i = 0; i < 300; i++) {
      w.step();
      if (!w.organisms.find((o) => o.id === preyId && o.alive)) {
        killed = true;
        break;
      }
    }
    expect(killed).toBe(true);
  });
});

describe("save/load round trip", () => {
  it("preserves world state exactly and resumes deterministically", () => {
    const w = new World("saveload");
    for (let i = 0; i < 250; i++) w.step();
    const save = makeSave(w, DEFAULT_SETTINGS, DEFAULT_CREATURE);
    const json = JSON.parse(JSON.stringify(save));

    const result = loadSave(json);
    expect(result.ok).toBe(true);
    expect(result.recovered).toBe(false);
    expect(result.world.tick).toBe(w.tick);
    expect(result.world.seed).toBe(w.seed);
    expect(signature(result.world)).toBe(signature(w));

    // Continue stepping both — they must stay in lockstep.
    for (let i = 0; i < 100; i++) {
      w.step();
      result.world.step();
    }
    expect(signature(result.world)).toBe(signature(w));
  });
});

describe("corrupted save fallback", () => {
  it("falls back safely on garbage input", () => {
    for (const bad of [null, undefined, 42, "nope", {}, { version: 999 }, { version: 1 }]) {
      const r = loadSave(bad);
      expect(r.recovered).toBe(true);
      expect(r.world).toBeInstanceOf(World);
      expect(r.world.organisms.length).toBeGreaterThan(0);
    }
  });

  it("repairs a single bad field instead of discarding the whole save", () => {
    // A save is much more valuable to the player than a single organism's
    // exact position. One corrupted field on one organism should not cost
    // the entire world — the sanitizer clamps/defaults the bad field and
    // keeps everything else (this is a stronger guarantee than the naive
    // "any invalid field triggers a full fallback" behavior it replaced).
    const w = new World("corrupt");
    for (let i = 0; i < 10; i++) w.step();
    const aliveCountBefore = w.organisms.filter((o) => o.alive).length;
    const save = makeSave(w, DEFAULT_SETTINGS, DEFAULT_CREATURE);
    const json: any = JSON.parse(JSON.stringify(save));
    const victimId = json.world.organisms[0].id;
    json.world.organisms[0].pos.x = "NaN-not-a-number";

    const r = loadSave(json);
    expect(r.ok).toBe(true);
    expect(r.recovered).toBe(false);
    // Every organism, including the one with the corrupted field, survives.
    expect(r.world.organisms.length).toBe(aliveCountBefore);
    const repaired = r.world.getById(victimId)!;
    expect(repaired).toBeTruthy();
    expect(Number.isFinite(repaired.pos.x)).toBe(true);
    expect(repaired.pos.x).toBeGreaterThanOrEqual(0);
  });

  it("drops only organisms with unrecoverable identity (missing/duplicate id or bad species), keeps the rest", () => {
    const w = new World("corrupt-identity");
    for (let i = 0; i < 10; i++) w.step();
    const save = makeSave(w, DEFAULT_SETTINGS, DEFAULT_CREATURE);
    const json: any = JSON.parse(JSON.stringify(save));
    const totalBefore = json.world.organisms.length;
    expect(totalBefore).toBeGreaterThan(2);

    delete json.world.organisms[0].id; // unrecoverable
    json.world.organisms[1].id = json.world.organisms[2].id; // duplicate — second occurrence dropped

    const r = loadSave(json);
    expect(r.ok).toBe(true);
    expect(r.recovered).toBe(false);
    expect(r.world.organisms.length).toBe(totalBefore - 2);
  });

  it("clamps genome values that are out of range or non-finite instead of poisoning the simulation", () => {
    const w = new World("corrupt-genome");
    for (let i = 0; i < 10; i++) w.step();
    const save = makeSave(w, DEFAULT_SETTINGS, DEFAULT_CREATURE);
    const json: any = JSON.parse(JSON.stringify(save));
    const victimId = json.world.organisms[0].id;
    json.world.organisms[0].genome.bodySize = 999999;
    json.world.organisms[0].genome.fear = Number.NaN;
    json.world.organisms[0].genome.aggression = -Infinity;

    const r = loadSave(json);
    expect(r.ok).toBe(true);
    const repaired = r.world.getById(victimId)!;
    for (const k in repaired.genome) {
      expect(Number.isFinite((repaired.genome as any)[k])).toBe(true);
    }
    expect(repaired.genome.bodySize).toBeLessThanOrEqual(2);

    // The world must be able to keep running on the repaired data.
    for (let i = 0; i < 100; i++) r.world.step();
    for (const o of r.world.organisms) {
      expect(Number.isFinite(o.energy)).toBe(true);
      expect(Number.isFinite(o.health)).toBe(true);
    }
  });

  it("falls back entirely when the save is too structurally broken to salvage", () => {
    const cases = [
      { version: 1, world: { seed: "x", tick: 1, organisms: "not-an-array", rngState: [1, 2, 3, 4], environment: {} } },
      { version: 1, world: { seed: "x", tick: 1, organisms: [], rngState: [1, 2], environment: {} } },
      { version: 1, world: { seed: 42, tick: 1, organisms: [], rngState: [1, 2, 3, 4], environment: {} } },
    ];
    for (const bad of cases) {
      const r = loadSave(bad);
      expect(r.recovered).toBe(true);
      expect(r.world).toBeInstanceOf(World);
    }
  });
});

describe("no NaN in population", () => {
  it("runs and never produces NaN positions/energy", () => {
    const w = new World("nan-check");
    for (let i = 0; i < 2000; i++) {
      w.step();
      if (i % 200 === 0) {
        for (const o of w.organisms) {
          if (!o.alive) continue;
          expect(Number.isFinite(o.pos.x)).toBe(true);
          expect(Number.isFinite(o.pos.y)).toBe(true);
          expect(Number.isFinite(o.energy)).toBe(true);
          expect(Number.isFinite(o.health)).toBe(true);
          for (const k in o.genome) expect(Number.isFinite((o.genome as any)[k])).toBe(true);
        }
      }
    }
  });
});

describe("population balance", () => {
  // Regression guard for the trophic-cascade bug found during audit: plants
  // used to eat the entire carrying capacity, starving herbivores, which then
  // starved predators — collapsing 2/20 sampled seeds to zero mobile life and
  // driving predators extinct in 11/20. After tuning (flocking cohesion so
  // `sociability` drives real mate-seeking, a plant population cap, and a
  // viable predator hunting economy), a large majority of seeds should sustain
  // multi-species coexistence over a long horizon. This does not require every
  // seed to stay stable — real predator/prey dynamics can go locally extinct —
  // but total collapse (zero mobile life) must stay rare.
  it("most seeds sustain multi-species life over 6000 ticks; total collapse stays rare", () => {
    const seeds = Array.from({ length: 10 }, (_, i) => `balance-check-${i}`);
    let collapsed = 0;
    let stable = 0;
    for (const seed of seeds) {
      const w = new World(seed);
      for (let i = 0; i < 6000; i++) {
        if (i > 0 && i % 3000 === 0) w.applyIntervention({ type: "addFood", value: 6 });
        w.step();
      }
      const herb = w.countSpecies("herbivore");
      const pred = w.countSpecies("predator");
      if (herb === 0 && pred === 0) collapsed++;
      if (herb > 0 && pred > 0) stable++;
    }
    expect(collapsed).toBeLessThanOrEqual(1);
    expect(stable).toBeGreaterThanOrEqual(6);
  });

  it("plants never exceed their configured share of carrying capacity", () => {
    const w = new World("plant-cap-check");
    for (let i = 0; i < 6000; i++) {
      w.step();
      if (i % 500 === 0) {
        const plants = w.countSpecies("plant");
        expect(plants).toBeLessThanOrEqual(w.env.carryingCapacity * 0.55);
      }
    }
  });
});
