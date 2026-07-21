/** Tunable simulation constants. Kept in one place for determinism review. */
export const CONFIG = {
  worldWidth: 1200,
  worldHeight: 800,
  cellSize: 80,

  initialPlants: 60,
  initialHerbivores: 24,
  initialPredators: 6,
  maxOrganisms: 700, // hard safety cap
  defaultCarryingCapacity: 320,

  dayLength: 2400, // ticks per day

  // Energy economy
  baseMetabolicCost: 0.02,
  moveCostFactor: 0.015,
  plantEnergyValue: 32,
  preyEnergyGain: 0.75, // fraction of prey energy gained on kill
  eatRadius: 12,
  attackRadius: 20,
  attackDamage: 22,
  attackCooldownTicks: 14,

  // Plant dynamics
  plantSeedEnergy: 20,
  plantMaxEnergy: 60,
  plantGrowthPerTick: 0.08,
  plantReproEnergy: 45,
  plantReproChance: 0.004,
  plantSpreadRadius: 60,
  plantCapFraction: 0.5, // plants may fill at most this fraction of carrying capacity

  // Reproduction
  reproMinEnergyFrac: 0.5, // must have >= this fraction of maxEnergy
  reproCostFrac: 0.32,
  reproCooldownTicks: 220,
  matingRadius: 30,
  gestationInstant: true,

  // Movement
  maxSpeedBase: 1.4,
  wanderJitter: 0.35,
  fleeMultiplier: 1.4,
  cohesionStrength: 0.01, // flocking pull toward same-species center (× sociability)

  // Environment
  droughtMoisture: 0.12,
  rainMoisture: 0.9,
  moistureReversion: 0.001,
  tempReversion: 0.002,

  // History sampling
  historyInterval: 60,
  maxHistorySamples: 600,
  memoryDecayTicks: 240,
  threatMemoryTicks: 150, // base window for residual fear after losing sight of a threat

  // Ascension thresholds
  ascendMinGeneration: 4,
  ascendMinAge: 1600,
} as const;
