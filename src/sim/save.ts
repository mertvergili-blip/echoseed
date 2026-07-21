import { World, SAVE_VERSION, type WorldSnapshot } from "./world";
import { GENOME_RANGES } from "./genome";
import { ACTION_NAMES } from "./protocol";
import { CONFIG } from "./config";
import type { Genome, Organism, Species } from "./types";

export interface UserSettings {
  simSpeed: number;
  paused: boolean;
  showDebug: boolean;
}

export interface CreatureState {
  hunger: number;
  energy: number;
  trust: number;
  curiosity: number;
  mood: number; // 0..1
  lastInteractionTick: number;
  windowX: number | null;
  windowY: number | null;
}

export interface SaveFile {
  version: number;
  savedAt: number;
  world: WorldSnapshot;
  settings: UserSettings;
  creature: CreatureState;
}

export const DEFAULT_SETTINGS: UserSettings = {
  simSpeed: 1,
  paused: false,
  showDebug: false,
};

export const DEFAULT_CREATURE: CreatureState = {
  hunger: 0.3,
  energy: 0.7,
  trust: 0.4,
  curiosity: 0.6,
  mood: 0.6,
  lastInteractionTick: 0,
  windowX: null,
  windowY: null,
};

/** Serialize the full app save. */
export function makeSave(
  world: World,
  settings: UserSettings,
  creature: CreatureState,
): SaveFile {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    world: world.snapshot(),
    settings,
    creature,
  };
}

export interface LoadResult {
  ok: boolean;
  world: World;
  settings: UserSettings;
  creature: CreatureState;
  recovered: boolean; // true if we fell back due to corruption / version drift
  reason?: string;
}

/**
 * Parse and validate a save. On any corruption we fall back to a fresh world
 * with a random seed rather than throwing, so the app always boots.
 */
export function loadSave(raw: unknown): LoadResult {
  const freshSeed = randomSeed();
  const fallback = (reason: string): LoadResult => ({
    ok: false,
    world: new World(freshSeed),
    settings: { ...DEFAULT_SETTINGS },
    creature: { ...DEFAULT_CREATURE },
    recovered: true,
    reason,
  });

  try {
    if (!raw || typeof raw !== "object") return fallback("empty or non-object save");
    const data = raw as Partial<SaveFile>;

    if (typeof data.version !== "number") return fallback("missing version");
    if (data.version > SAVE_VERSION) return fallback("save from newer version");

    const migrated = migrate(data);
    if (!migrated.world || typeof migrated.world !== "object") {
      return fallback("missing world");
    }
    if (!validateWorld(migrated.world)) return fallback("world failed validation");

    // Sanitize each organism *before* constructing the World: clamp every
    // numeric field (genome values, health, energy, age, velocity, position)
    // into valid ranges and drop organisms that are unrecoverable (missing
    // id/species). A save corrupted by a bad edit, disk error, or an
    // out-of-range value from a future version should degrade gracefully —
    // losing a handful of malformed organisms, not the whole world — rather
    // than either crashing or silently carrying NaN/Infinity into the
    // simulation where it would propagate (e.g. energy/maxEnergy → NaN,
    // then poisoning every score that reads energyFrac).
    const snap = migrated.world as WorldSnapshot;
    const seenIds = new Set<number>();
    const cleanOrganisms: Organism[] = [];
    for (const raw of snap.organisms as unknown[]) {
      const o = sanitizeOrganism(raw, seenIds);
      if (o) {
        seenIds.add(o.id);
        cleanOrganisms.push(o);
      }
    }
    snap.organisms = cleanOrganisms;
    snap.nextId = sanitizeNextId(snap.nextId, cleanOrganisms);

    const world = World.fromSnapshot(snap);

    const settings = sanitizeSettings(migrated.settings);
    const creature = sanitizeCreature(migrated.creature);

    return { ok: true, world, settings, creature, recovered: false };
  } catch (e) {
    return fallback("exception: " + (e as Error).message);
  }
}

/** Version migration hook (currently identity; grows as schema evolves). */
function migrate(data: Partial<SaveFile>): Partial<SaveFile> {
  // v1 is current. Future: if (data.version === 0) { ...upgrade... }
  return data;
}

function validateWorld(w: any): boolean {
  if (typeof w.seed !== "string") return false;
  if (typeof w.tick !== "number" || !Number.isFinite(w.tick)) return false;
  if (!Array.isArray(w.organisms)) return false;
  if (!Array.isArray(w.rngState) || w.rngState.length !== 4) return false;
  if (!w.environment || typeof w.environment !== "object") return false;
  if (!Array.isArray(w.history)) w.history = [];
  if (!Array.isArray(w.lineage)) w.lineage = [];
  if (!Array.isArray(w.interventions)) w.interventions = [];
  return true;
}

function sanitizeSettings(s: any): UserSettings {
  if (!s || typeof s !== "object") return { ...DEFAULT_SETTINGS };
  return {
    simSpeed: clampNum(s.simSpeed, 1, 16, 1),
    paused: !!s.paused,
    showDebug: !!s.showDebug,
  };
}

function sanitizeCreature(c: any): CreatureState {
  if (!c || typeof c !== "object") return { ...DEFAULT_CREATURE };
  return {
    hunger: clampNum(c.hunger, 0, 1, 0.3),
    energy: clampNum(c.energy, 0, 1, 0.7),
    trust: clampNum(c.trust, 0, 1, 0.4),
    curiosity: clampNum(c.curiosity, 0, 1, 0.6),
    mood: clampNum(c.mood, 0, 1, 0.6),
    lastInteractionTick: clampNum(c.lastInteractionTick, 0, Number.MAX_SAFE_INTEGER, 0),
    windowX: typeof c.windowX === "number" && Number.isFinite(c.windowX) ? c.windowX : null,
    windowY: typeof c.windowY === "number" && Number.isFinite(c.windowY) ? c.windowY : null,
  };
}

function clampNum(v: any, min: number, max: number, dflt: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return dflt;
  return Math.max(min, Math.min(max, v));
}

const VALID_SPECIES: Species[] = ["plant", "herbivore", "predator"];
const GENE_KEY_LIST = Object.keys(GENOME_RANGES) as (keyof Genome)[];

function sanitizeGenome(raw: any): Genome {
  const g = {} as Genome;
  for (const k of GENE_KEY_LIST) {
    const [min, max] = GENOME_RANGES[k];
    const v = raw && typeof raw === "object" ? raw[k] : undefined;
    g[k] = clampNum(v, min, max, (min + max) / 2) as never;
  }
  return g;
}

function sanitizeVec(raw: any, maxMag: number): { x: number; y: number } {
  const x = clampNum(raw?.x, -maxMag, maxMag, 0);
  const y = clampNum(raw?.y, -maxMag, maxMag, 0);
  return { x, y };
}

/**
 * Validate and repair a single organism from an untrusted save. Returns null
 * only when the organism is unrecoverable (missing/invalid id or species, or
 * a duplicate id already claimed by an earlier organism in the same save) —
 * every other field is clamped or defaulted rather than rejecting the whole
 * organism, so a save with one bad field doesn't cost the player an entire
 * creature.
 */
function sanitizeOrganism(raw: unknown, seenIds: ReadonlySet<number>): Organism | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, any>;

  const id = o.id;
  if (typeof id !== "number" || !Number.isFinite(id) || !Number.isInteger(id) || id < 0) {
    return null;
  }
  if (seenIds.has(id)) return null; // duplicate id — keep the first occurrence

  const species: Species = VALID_SPECIES.includes(o.species) ? o.species : "herbivore";
  const genome = sanitizeGenome(o.genome);

  // Recompute caps from the (now-valid) genome rather than trusting stored
  // maxHealth/maxEnergy directly — this is what World.makeOrganism does for
  // freshly spawned organisms, so a corrupted or missing cap self-heals to a
  // value consistent with the rest of the organism instead of e.g. becoming
  // 0 and turning every energyFrac computation into NaN or Infinity.
  const derivedMaxHealth = 40 + genome.bodySize * 60;
  const derivedMaxEnergy = 50 + genome.bodySize * 50;
  const maxHealth = clampNum(o.maxHealth, 1, 1e6, derivedMaxHealth);
  const maxEnergy = clampNum(o.maxEnergy, 1, 1e6, derivedMaxEnergy);

  const worldMax = Math.max(CONFIG.worldWidth, CONFIG.worldHeight);
  const pos = sanitizeVec(o.pos, worldMax * 2);
  pos.x = Math.max(0, Math.min(CONFIG.worldWidth, pos.x));
  pos.y = Math.max(0, Math.min(CONFIG.worldHeight, pos.y));
  const vel = sanitizeVec(o.vel, CONFIG.maxSpeedBase * 20); // generous but bounded
  const target =
    o.target && typeof o.target === "object" ? sanitizeVec(o.target, worldMax * 2) : null;

  const action = ACTION_NAMES.includes(o.action) ? o.action : "wander";

  const rawParents = o.parentIds;
  const parentIds: [number, number] | null =
    Array.isArray(rawParents) &&
    rawParents.length === 2 &&
    rawParents.every((p) => typeof p === "number" && Number.isFinite(p))
      ? [rawParents[0], rawParents[1]]
      : null;

  const m = o.memory && typeof o.memory === "object" ? o.memory : {};
  const memory = {
    lastThreatPos:
      m.lastThreatPos && typeof m.lastThreatPos === "object" ? sanitizeVec(m.lastThreatPos, worldMax * 2) : null,
    lastThreatTick: clampNum(m.lastThreatTick, -1e9, 1e12, -99999),
    lastFoodPos:
      m.lastFoodPos && typeof m.lastFoodPos === "object" ? sanitizeVec(m.lastFoodPos, worldMax * 2) : null,
    lastFoodTick: clampNum(m.lastFoodTick, -1e9, 1e12, -99999),
    matingCooldown: clampNum(m.matingCooldown, 0, 1e6, 0),
  };

  return {
    id,
    species,
    generation: Math.max(0, Math.round(clampNum(o.generation, 0, 1e6, 0))),
    parentIds,
    age: Math.max(0, Math.round(clampNum(o.age, 0, 1e9, 0))),
    health: clampNum(o.health, 0, maxHealth, maxHealth),
    energy: clampNum(o.energy, 0, maxEnergy, maxEnergy * 0.5),
    pos,
    vel,
    target,
    action,
    genome,
    memory,
    maxHealth,
    maxEnergy,
    attackCooldown: Math.max(0, Math.round(clampNum(o.attackCooldown, 0, 1e6, 0))),
    reproCooldown: Math.max(0, Math.round(clampNum(o.reproCooldown, 0, 1e6, 0))),
    offspringCount: Math.max(0, Math.round(clampNum(o.offspringCount, 0, 1e9, 0))),
    alive: true,
  };
}

/** Ensure nextId is always strictly greater than every surviving organism id. */
function sanitizeNextId(raw: unknown, organisms: Organism[]): number {
  let maxId = 0;
  for (const o of organisms) if (o.id > maxId) maxId = o.id;
  const candidate = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 0;
  return Math.max(candidate, maxId + 1, 1);
}

export function randomSeed(): string {
  const words = ["echo", "seed", "flux", "myca", "loom", "veil", "drift", "spore", "aether", "lumen"];
  const a = words[Math.floor(Math.random() * words.length)];
  const b = words[Math.floor(Math.random() * words.length)];
  const n = Math.floor(Math.random() * 9000) + 1000;
  return `${a}-${b}-${n}`;
}
