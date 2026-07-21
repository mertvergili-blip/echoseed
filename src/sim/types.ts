/** Core simulation data types shared across worker, renderer, and UI. */

export type Species = "plant" | "herbivore" | "predator";

export type Action =
  | "wander"
  | "seekFood"
  | "seekWater"
  | "flee"
  | "chase"
  | "attack"
  | "rest"
  | "mate"
  | "investigate"
  | "sleep";

export interface Vec2 {
  x: number;
  y: number;
}

/** Heritable traits. All values are normalized-ish; see GENOME_RANGES. */
export interface Genome {
  bodySize: number; // 0.5..2  physical scale, affects health/energy capacity
  movementSpeed: number; // 0.4..2 base locomotion multiplier
  visionRadius: number; // 20..160 perception distance in world units
  metabolism: number; // 0.5..2 energy burn rate
  aggression: number; // 0..1  willingness to chase/attack
  fear: number; // 0..1  flee sensitivity
  curiosity: number; // 0..1  investigate tendency
  sociability: number; // 0..1  attraction to same species
  fertility: number; // 0..1  reproduction drive/success
  mutationRate: number; // 0..0.5 per-gene mutation probability passed down
  sleepTendency: number; // 0..1  how strongly night triggers sleep
  preferredTemp: number; // 0..1  thermal comfort center
  visualHue: number; // 0..360 base hue
  bodyProportion: number; // 0.5..1.5 limb/appendage length factor
}

export interface Organism {
  id: number;
  species: Species;
  generation: number;
  parentIds: [number, number] | null;
  age: number; // ticks alive
  health: number;
  energy: number;
  pos: Vec2;
  vel: Vec2;
  target: Vec2 | null;
  action: Action;
  genome: Genome;
  /** Short-term memory: recently seen threats / food, decays over time. */
  memory: {
    lastThreatPos: Vec2 | null;
    lastThreatTick: number;
    lastFoodPos: Vec2 | null;
    lastFoodTick: number;
    matingCooldown: number;
  };
  // Derived caps (recomputed from genome on creation), avoids per-tick recompute.
  maxHealth: number;
  maxEnergy: number;
  // Predator/attack bookkeeping
  attackCooldown: number;
  // Reproduction bookkeeping
  reproCooldown: number;
  offspringCount: number;
  alive: boolean;
}

export interface Environment {
  timeOfDay: number; // 0..1  (0 = midnight, 0.5 = noon)
  dayLength: number; // ticks per full day
  temperature: number; // 0..1 normalized (cold..hot)
  baseTemperature: number; // seasonal baseline
  moisture: number; // 0..1
  plantGrowthRate: number; // multiplier
  carryingCapacity: number; // soft cap on total organisms
  weather: "clear" | "rain" | "drought" | "cold";
  weatherTicks: number; // remaining ticks of current weather event
}

export type InterventionType =
  | "addFood"
  | "rain"
  | "drought"
  | "cold"
  | "setTemperature"
  | "addHerbivore"
  | "addPredator"
  | "remove"
  | "mutate"
  | "reset";

export interface Intervention {
  tick: number;
  type: InterventionType;
  x?: number;
  y?: number;
  value?: number;
  id?: number;
}

export interface FoodPellet {
  id: number;
  pos: Vec2;
  amount: number;
}

/** A recorded historical sample for graphs. */
export interface HistorySample {
  tick: number;
  plants: number;
  herbivores: number;
  predators: number;
  avgGeneration: number;
  temperature: number;
  moisture: number;
}

export interface LineageNode {
  id: number;
  species: Species;
  generation: number;
  parentIds: [number, number] | null;
  bornTick: number;
  diedTick: number | null;
  offspring: number;
}

export interface SimStats {
  fps: number;
  tps: number;
}
