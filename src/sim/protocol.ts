import type {
  Organism,
  Environment,
  HistorySample,
  LineageNode,
  Genome,
  InterventionType,
} from "./types";
import type { WorldSnapshot } from "./world";
import type { UserSettings, CreatureState } from "./save";

/** Messages sent from main thread -> worker. */
export type ToWorker =
  | { type: "init"; seed: string }
  | { type: "loadSnapshot"; snapshot: WorldSnapshot }
  | { type: "setSpeed"; speed: number }
  | { type: "pause"; paused: boolean }
  | { type: "setBackground"; background: boolean }
  | { type: "intervene"; intervention: { type: InterventionType; x?: number; y?: number; value?: number; id?: number } }
  | { type: "ascend"; id: number }
  | { type: "requestSnapshot"; token: number }
  | { type: "requestFullOrganism"; id: number };

/** Lightweight per-organism render payload (avoids shipping full objects). */
export interface RenderOrganism {
  id: number;
  species: 0 | 1 | 2; // plant, herbivore, predator
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  size: number;
  proportion: number;
  energyFrac: number;
  healthFrac: number;
  action: number;
  generation: number;
  ascended: boolean;
}

export interface FrameData {
  tick: number;
  organisms: RenderOrganism[];
  env: Environment;
  counts: { plants: number; herbivores: number; predators: number };
  avgGeneration: number;
  ascendedId: number | null;
  tps: number;
  dominantTraits: Partial<Genome> | null;
}

/** Messages sent from worker -> main thread. */
export type FromWorker =
  | { type: "frame"; data: FrameData }
  | { type: "snapshot"; token: number; snapshot: WorldSnapshot }
  | { type: "history"; history: HistorySample[] }
  | { type: "lineage"; lineage: LineageNode[] }
  | { type: "organism"; organism: Organism | null }
  | { type: "ready" };

export const ACTION_INDEX: Record<string, number> = {
  wander: 0,
  seekFood: 1,
  seekWater: 2,
  flee: 3,
  chase: 4,
  attack: 5,
  rest: 6,
  mate: 7,
  investigate: 8,
  sleep: 9,
};

export const ACTION_NAMES = [
  "wander",
  "seekFood",
  "seekWater",
  "flee",
  "chase",
  "attack",
  "rest",
  "mate",
  "investigate",
  "sleep",
];

export const SPECIES_INDEX: Record<string, 0 | 1 | 2> = {
  plant: 0,
  herbivore: 1,
  predator: 2,
};

export type { Genome, UserSettings, CreatureState };
