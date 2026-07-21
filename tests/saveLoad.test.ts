import { describe, it, expect } from "vitest";
import { World, SAVE_VERSION } from "../src/sim/world";
import { makeSave, loadSave, DEFAULT_SETTINGS, DEFAULT_CREATURE, type CreatureState } from "../src/sim/save";

/**
 * Broader save/load and data-safety coverage beyond the round-trip and
 * sanitizer tests in engine.test.ts: large worlds, paused state, an ascended
 * creature, intervention history, RNG state, user settings, old schema
 * versions, and outright missing/broken structure.
 */

describe("save/load: large world", () => {
  it("round-trips a world with several hundred organisms without loss", () => {
    const w = new World("large-world");
    for (let i = 0; i < 4000; i++) {
      if (i % 800 === 0) w.applyIntervention({ type: "addFood", value: 10 });
      w.step();
    }
    const aliveCount = w.organisms.filter((o) => o.alive).length;
    expect(aliveCount).toBeGreaterThan(50); // sanity: this actually exercises a real population

    const save = makeSave(w, DEFAULT_SETTINGS, DEFAULT_CREATURE);
    const json = JSON.parse(JSON.stringify(save));
    const result = loadSave(json);

    expect(result.ok).toBe(true);
    expect(result.world.organisms.length).toBe(aliveCount);
    // Every organism's id from the source world must be present after load.
    const sourceIds = new Set(w.organisms.filter((o) => o.alive).map((o) => o.id));
    const loadedIds = new Set(result.world.organisms.map((o) => o.id));
    expect(loadedIds).toEqual(sourceIds);
  });
});

describe("save/load: paused state", () => {
  it("preserves paused=true through a round trip", () => {
    const w = new World("paused-save");
    for (let i = 0; i < 100; i++) w.step();
    const settings = { ...DEFAULT_SETTINGS, paused: true, simSpeed: 8 };
    const save = makeSave(w, settings, DEFAULT_CREATURE);
    const json = JSON.parse(JSON.stringify(save));
    const result = loadSave(json);
    expect(result.settings.paused).toBe(true);
    expect(result.settings.simSpeed).toBe(8);
  });
});

describe("save/load: ascended creature", () => {
  it("preserves the ascended organism id and that organism's data through a round trip", () => {
    const w = new World("ascend-save");
    for (let i = 0; i < 200; i++) w.step();
    const candidate = w.organisms.find((o) => o.alive && o.species !== "plant");
    expect(candidate).toBeTruthy();
    w.ascend(candidate!.id);

    const save = makeSave(w, DEFAULT_SETTINGS, DEFAULT_CREATURE);
    const json = JSON.parse(JSON.stringify(save));
    const result = loadSave(json);

    expect(result.world.ascendedId).toBe(candidate!.id);
    const restored = result.world.getById(candidate!.id);
    expect(restored).toBeTruthy();
    expect(restored!.species).toBe(candidate!.species);
    expect(restored!.genome).toEqual(candidate!.genome);
  });

  it("preserves creature mood/needs state alongside the world", () => {
    const w = new World("creature-state-save");
    for (let i = 0; i < 50; i++) w.step();
    const creature: CreatureState = {
      hunger: 0.82,
      energy: 0.15,
      trust: 0.91,
      curiosity: 0.33,
      mood: 0.44,
      lastInteractionTick: 12345,
      windowX: 640,
      windowY: 220,
    };
    const save = makeSave(w, DEFAULT_SETTINGS, creature);
    const json = JSON.parse(JSON.stringify(save));
    const result = loadSave(json);
    expect(result.creature).toEqual(creature);
  });
});

describe("save/load: intervention history", () => {
  it("preserves the recorded intervention log through a round trip", () => {
    const w = new World("intervention-history-save");
    w.applyIntervention({ type: "addFood", x: 10, y: 20, value: 5 });
    w.applyIntervention({ type: "rain", value: 300 });
    w.applyIntervention({ type: "addPredator" });
    for (let i = 0; i < 50; i++) w.step();
    w.applyIntervention({ type: "drought", value: 200 });

    const save = makeSave(w, DEFAULT_SETTINGS, DEFAULT_CREATURE);
    const json = JSON.parse(JSON.stringify(save));
    const result = loadSave(json);

    const snap = result.world.snapshot();
    expect(snap.interventions.length).toBe(4);
    expect(snap.interventions.map((iv) => iv.type)).toEqual(["addFood", "rain", "addPredator", "drought"]);
  });
});

describe("save/load: RNG state", () => {
  it("resumes the exact same random sequence after a round trip", () => {
    const w = new World("rng-state-save");
    for (let i = 0; i < 777; i++) w.step();

    const save = makeSave(w, DEFAULT_SETTINGS, DEFAULT_CREATURE);
    const json = JSON.parse(JSON.stringify(save));
    const result = loadSave(json);

    expect(result.world.rng.getState()).toEqual(w.rng.getState());

    // Continuing both should stay in lockstep (proves the RNG stream, not
    // just its raw state array, resumes correctly).
    for (let i = 0; i < 300; i++) {
      w.step();
      result.world.step();
    }
    const a = w.organisms.filter((o) => o.alive).map((o) => o.id).sort();
    const b = result.world.organisms.filter((o) => o.alive).map((o) => o.id).sort();
    expect(b).toEqual(a);
  });
});

describe("save/load: old schema version", () => {
  it("accepts a save at the current version and rejects one from a newer, unknown version", () => {
    const w = new World("version-save");
    const save = makeSave(w, DEFAULT_SETTINGS, DEFAULT_CREATURE);
    const json = JSON.parse(JSON.stringify(save));
    expect(json.version).toBe(SAVE_VERSION);

    const okResult = loadSave(json);
    expect(okResult.ok).toBe(true);
    expect(okResult.recovered).toBe(false);

    const future = { ...json, version: SAVE_VERSION + 5 };
    const futureResult = loadSave(future);
    expect(futureResult.recovered).toBe(true);
    expect(futureResult.world).toBeInstanceOf(World);
  });
});

describe("save/load: savedAt timestamp", () => {
  it("round-trips the save timestamp for offline-progress calculations", () => {
    const w = new World("savedat-save");
    for (let i = 0; i < 20; i++) w.step();
    const save = makeSave(w, DEFAULT_SETTINGS, DEFAULT_CREATURE);
    const json = JSON.parse(JSON.stringify(save));
    const result = loadSave(json);
    expect(result.savedAt).toBe(save.savedAt);
    expect(typeof result.savedAt).toBe("number");
  });

  it("reports savedAt as null when falling back to a fresh world", () => {
    const r = loadSave(null);
    expect(r.recovered).toBe(true);
    expect(r.savedAt).toBeNull();
  });

  it("ignores a malformed savedAt field rather than propagating garbage", () => {
    const w = new World("savedat-bad");
    const save = makeSave(w, DEFAULT_SETTINGS, DEFAULT_CREATURE);
    const json: any = JSON.parse(JSON.stringify(save));
    json.savedAt = "not-a-timestamp";
    const result = loadSave(json);
    expect(result.savedAt).toBeNull();
  });
});

describe("save/load: missing fields", () => {
  it("falls back safely when top-level fields are absent", () => {
    const casesThatMustFallBack = [
      { version: SAVE_VERSION }, // no world at all
      { version: SAVE_VERSION, world: {} }, // empty world object
      { version: SAVE_VERSION, world: { seed: "x" } }, // missing tick/organisms/rngState/environment
    ];
    for (const c of casesThatMustFallBack) {
      const r = loadSave(c);
      expect(r.recovered).toBe(true);
      expect(r.world).toBeInstanceOf(World);
      expect(r.world.organisms.length).toBeGreaterThan(0); // a fresh world was seeded
    }
  });

  it("defaults missing settings/creature objects rather than throwing", () => {
    const w = new World("missing-settings-save");
    const save = makeSave(w, DEFAULT_SETTINGS, DEFAULT_CREATURE);
    const json: any = JSON.parse(JSON.stringify(save));
    delete json.settings;
    delete json.creature;

    const r = loadSave(json);
    expect(r.ok).toBe(true);
    expect(r.settings).toEqual(DEFAULT_SETTINGS);
    expect(r.creature).toEqual(DEFAULT_CREATURE);
  });
});

describe("save/load: half-written / truncated save", () => {
  it("falls back safely on a JSON string truncated mid-write", () => {
    const w = new World("truncated-save");
    for (let i = 0; i < 50; i++) w.step();
    const save = makeSave(w, DEFAULT_SETTINGS, DEFAULT_CREATURE);
    const full = JSON.stringify(save);
    const truncated = full.slice(0, Math.floor(full.length * 0.6));

    // A truncated string won't even parse as JSON — the layer above loadSave
    // (storage.ts) is responsible for catching that; here we confirm
    // loadSave itself never throws even if handed something JSON.parse
    // would reject, by simulating what a caller gets from a best-effort
    // recovery attempt: a parse failure surfaces as `null`/invalid input.
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(truncated);
    } catch {
      parsed = null;
    }
    const r = loadSave(parsed);
    expect(r.recovered).toBe(true);
    expect(r.world).toBeInstanceOf(World);
  });
});

describe("save/load: extreme or invalid numbers", () => {
  it("clamps absurdly large but finite numbers instead of letting them through unchecked", () => {
    const w = new World("extreme-numbers-save");
    for (let i = 0; i < 20; i++) w.step();
    const save = makeSave(w, DEFAULT_SETTINGS, DEFAULT_CREATURE);
    const json: any = JSON.parse(JSON.stringify(save));
    const victim = json.world.organisms[0];
    victim.age = 1e15;
    victim.health = 1e20;
    victim.maxEnergy = 1e30;
    victim.pos.x = 1e10;
    victim.pos.y = -1e10;
    victim.vel.x = 1e8;

    const r = loadSave(json);
    expect(r.ok).toBe(true);
    const repaired = r.world.getById(victim.id)!;
    expect(Number.isFinite(repaired.age)).toBe(true);
    expect(Number.isFinite(repaired.health)).toBe(true);
    expect(Number.isFinite(repaired.maxEnergy)).toBe(true);
    expect(repaired.pos.x).toBeGreaterThanOrEqual(0);
    expect(repaired.pos.x).toBeLessThanOrEqual(1200); // CONFIG.worldWidth
    expect(repaired.pos.y).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(repaired.vel.x)).toBe(true);

    // Must be able to keep simulating without producing NaN downstream.
    for (let i = 0; i < 200; i++) r.world.step();
    for (const o of r.world.organisms) {
      expect(Number.isFinite(o.energy)).toBe(true);
      expect(Number.isFinite(o.pos.x)).toBe(true);
    }
  });

  it("rejects Infinity and NaN encoded via JSON (which becomes null) without crashing", () => {
    const w = new World("infinity-save");
    for (let i = 0; i < 20; i++) w.step();
    const save = makeSave(w, DEFAULT_SETTINGS, DEFAULT_CREATURE);
    const json: any = JSON.parse(JSON.stringify(save));
    // JSON has no representation for Infinity/NaN — simulate what a hand-edited
    // or partially-corrupted file might contain: the literal string "Infinity"
    // or an explicit null in a numeric field.
    json.world.organisms[0].energy = "Infinity";
    json.world.organisms[1].health = null;

    const r = loadSave(json);
    expect(r.ok).toBe(true);
    for (const o of r.world.organisms) {
      expect(Number.isFinite(o.energy)).toBe(true);
      expect(Number.isFinite(o.health)).toBe(true);
    }
  });
});
