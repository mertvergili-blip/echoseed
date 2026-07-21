import { World, SAVE_VERSION, type WorldSnapshot } from "./world";

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

    const world = World.fromSnapshot(migrated.world as WorldSnapshot);

    // Sanity: every organism must have finite fields.
    for (const o of world.organisms) {
      if (!Number.isFinite(o.pos.x) || !Number.isFinite(o.pos.y) || !Number.isFinite(o.energy)) {
        return fallback("organism has non-finite fields");
      }
    }

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

export function randomSeed(): string {
  const words = ["echo", "seed", "flux", "myca", "loom", "veil", "drift", "spore", "aether", "lumen"];
  const a = words[Math.floor(Math.random() * words.length)];
  const b = words[Math.floor(Math.random() * words.length)];
  const n = Math.floor(Math.random() * 9000) + 1000;
  return `${a}-${b}-${n}`;
}
