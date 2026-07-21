import { Rng } from "./rng";
import { SpatialHash, rebuild } from "./spatial";
import { CONFIG } from "./config";
import { randomGenome, crossover, forceMutate } from "./genome";
import type {
  Organism,
  Genome,
  Species,
  Environment,
  Intervention,
  HistorySample,
  LineageNode,
  Vec2,
  Action,
} from "./types";

export interface WorldSnapshot {
  version: number;
  seed: string;
  tick: number;
  nextId: number;
  rngState: [number, number, number, number];
  organisms: Organism[];
  environment: Environment;
  interventions: Intervention[];
  history: HistorySample[];
  lineage: LineageNode[];
  ascendedId: number | null;
}

export const SAVE_VERSION = 1;

function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * The deterministic ecosystem. Given a seed and a sequence of interventions,
 * stepping the same number of ticks always yields the same state.
 */
export class World {
  seed: string;
  tick = 0;
  nextId = 1;
  rng: Rng;
  organisms: Organism[] = [];
  env: Environment;
  interventions: Intervention[] = [];
  history: HistorySample[] = [];
  lineage: LineageNode[] = [];
  lineageById = new Map<number, LineageNode>();
  ascendedId: number | null = null;

  private hash: SpatialHash;
  // Scratch buffers reused each tick to minimize allocation.
  private scratchNeighbors: number[] = [];

  constructor(seed: string) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.hash = new SpatialHash(CONFIG.worldWidth, CONFIG.worldHeight, CONFIG.cellSize);
    this.env = {
      timeOfDay: 0.3,
      dayLength: CONFIG.dayLength,
      temperature: 0.5,
      baseTemperature: 0.5,
      moisture: 0.6,
      plantGrowthRate: 1,
      carryingCapacity: CONFIG.defaultCarryingCapacity,
      weather: "clear",
      weatherTicks: 0,
    };
    this.seedInitial();
  }

  private seedInitial(): void {
    for (let i = 0; i < CONFIG.initialPlants; i++) this.spawn("plant", null, null, 0);
    for (let i = 0; i < CONFIG.initialHerbivores; i++) this.spawn("herbivore", null, null, 0);
    for (let i = 0; i < CONFIG.initialPredators; i++) this.spawn("predator", null, null, 0);
  }

  private makeOrganism(
    species: Species,
    genome: Genome,
    pos: Vec2,
    generation: number,
    parentIds: [number, number] | null,
  ): Organism {
    const id = this.nextId++;
    const maxHealth = 40 + genome.bodySize * 60;
    const maxEnergy = 50 + genome.bodySize * 50;
    const o: Organism = {
      id,
      species,
      generation,
      parentIds,
      age: 0,
      health: maxHealth,
      energy: species === "plant" ? CONFIG.plantSeedEnergy : maxEnergy * 0.7,
      pos: { x: pos.x, y: pos.y },
      vel: { x: 0, y: 0 },
      target: null,
      action: species === "plant" ? "rest" : "wander",
      genome,
      memory: {
        lastThreatPos: null,
        lastThreatTick: -99999,
        lastFoodPos: null,
        lastFoodTick: -99999,
        matingCooldown: 0,
      },
      maxHealth,
      maxEnergy,
      attackCooldown: 0,
      reproCooldown: species === "plant" ? 0 : CONFIG.reproCooldownTicks,
      offspringCount: 0,
      alive: true,
    };
    const node: LineageNode = {
      id,
      species,
      generation,
      parentIds,
      bornTick: this.tick,
      diedTick: null,
      offspring: 0,
    };
    this.lineage.push(node);
    this.lineageById.set(id, node);
    return o;
  }

  spawn(
    species: Species,
    genome: Genome | null,
    pos: Vec2 | null,
    generation: number,
    parentIds: [number, number] | null = null,
  ): Organism | null {
    if (this.organisms.length >= CONFIG.maxOrganisms) return null;
    const g = genome ?? randomGenome(this.rng, species);
    const p = pos ?? {
      x: this.rng.range(20, CONFIG.worldWidth - 20),
      y: this.rng.range(20, CONFIG.worldHeight - 20),
    };
    const o = this.makeOrganism(species, g, p, generation, parentIds);
    this.organisms.push(o);
    return o;
  }

  // ---- Interventions --------------------------------------------------------

  applyIntervention(iv: Omit<Intervention, "tick">): void {
    const full: Intervention = { ...iv, tick: this.tick };
    this.interventions.push(full);
    this.execIntervention(full);
  }

  private execIntervention(iv: Intervention): void {
    switch (iv.type) {
      case "addFood": {
        // Spawn a cluster of plants as food.
        const cx = iv.x ?? this.rng.range(0, CONFIG.worldWidth);
        const cy = iv.y ?? this.rng.range(0, CONFIG.worldHeight);
        const n = iv.value ?? 6;
        for (let i = 0; i < n; i++) {
          const p = {
            x: cx + this.rng.range(-40, 40),
            y: cy + this.rng.range(-40, 40),
          };
          const plant = this.spawn("plant", null, this.clampPos(p), 0);
          if (plant) plant.energy = CONFIG.plantMaxEnergy;
        }
        break;
      }
      case "rain":
        this.env.weather = "rain";
        this.env.weatherTicks = iv.value ?? 600;
        break;
      case "drought":
        this.env.weather = "drought";
        this.env.weatherTicks = iv.value ?? 600;
        break;
      case "cold":
        this.env.weather = "cold";
        this.env.weatherTicks = iv.value ?? 600;
        break;
      case "setTemperature":
        this.env.baseTemperature = Math.max(0, Math.min(1, iv.value ?? 0.5));
        break;
      case "addHerbivore":
        this.spawn(
          "herbivore",
          null,
          iv.x != null ? this.clampPos({ x: iv.x, y: iv.y ?? 0 }) : null,
          0,
        );
        break;
      case "addPredator":
        this.spawn(
          "predator",
          null,
          iv.x != null ? this.clampPos({ x: iv.x, y: iv.y ?? 0 }) : null,
          0,
        );
        break;
      case "remove":
        if (iv.id != null) {
          const o = this.organisms.find((x) => x.id === iv.id && x.alive);
          if (o) this.kill(o, "removed");
        }
        break;
      case "mutate":
        if (iv.id != null) {
          const o = this.organisms.find((x) => x.id === iv.id && x.alive);
          if (o) o.genome = forceMutate(o.genome, this.rng);
        }
        break;
      case "reset":
        // Handled by caller (creates a new World); recorded for history only.
        break;
    }
  }

  private clampPos(p: Vec2): Vec2 {
    return {
      x: Math.max(4, Math.min(CONFIG.worldWidth - 4, p.x)),
      y: Math.max(4, Math.min(CONFIG.worldHeight - 4, p.y)),
    };
  }

  // ---- Main step ------------------------------------------------------------

  step(): void {
    this.tick++;
    this.updateEnvironment();
    rebuild(this.hash, this.organisms);

    const isNight = this.env.timeOfDay < 0.22 || this.env.timeOfDay > 0.78;

    for (let i = 0; i < this.organisms.length; i++) {
      const o = this.organisms[i];
      if (!o.alive) continue;
      o.age++;
      if (o.attackCooldown > 0) o.attackCooldown--;
      if (o.reproCooldown > 0) o.reproCooldown--;
      if (o.memory.matingCooldown > 0) o.memory.matingCooldown--;

      if (o.species === "plant") {
        this.stepPlant(o);
      } else {
        this.stepCreature(o, isNight);
      }
    }

    // Remove the dead lazily to keep indices stable during the loop.
    if (this.tick % 30 === 0) this.compact();

    if (this.tick % CONFIG.historyInterval === 0) this.sample();
    this.maybeAutoAscend();
  }

  private updateEnvironment(): void {
    const e = this.env;
    // Phase-shifted so a fresh world (tick 0) opens in daylight rather than
    // at midnight — without this, every new simulation's first ~500 ticks
    // were "night", and most organisms would immediately go idle/asleep
    // before the player had seen anything move.
    const dayOffset = e.dayLength * 0.4;
    e.timeOfDay = ((this.tick + dayOffset) % e.dayLength) / e.dayLength;

    // Diurnal temperature: warm at noon, cold at night, around baseline.
    const diurnal = Math.sin((e.timeOfDay - 0.25) * Math.PI * 2) * 0.18;
    let targetTemp = e.baseTemperature + diurnal;

    if (e.weatherTicks > 0) {
      e.weatherTicks--;
      if (e.weather === "rain") {
        e.moisture += (CONFIG.rainMoisture - e.moisture) * 0.02;
        targetTemp -= 0.05;
      } else if (e.weather === "drought") {
        e.moisture += (CONFIG.droughtMoisture - e.moisture) * 0.01;
        targetTemp += 0.08;
      } else if (e.weather === "cold") {
        targetTemp -= 0.25;
      }
      if (e.weatherTicks === 0) e.weather = "clear";
    } else {
      e.moisture += (0.55 - e.moisture) * CONFIG.moistureReversion;
    }

    e.temperature += (targetTemp - e.temperature) * 0.05;
    e.temperature = Math.max(0, Math.min(1, e.temperature));
    e.moisture = Math.max(0, Math.min(1, e.moisture));

    // Growth favoured by moisture and moderate temperature.
    const tempComfort = 1 - Math.abs(e.temperature - 0.5) * 1.4;
    e.plantGrowthRate = Math.max(0.05, e.moisture * 0.7 + tempComfort * 0.5);
  }

  private stepPlant(o: Organism): void {
    // Grow using environmental growth rate.
    if (o.energy < CONFIG.plantMaxEnergy) {
      o.energy += CONFIG.plantGrowthPerTick * this.env.plantGrowthRate;
    }
    o.health = Math.min(o.maxHealth, o.health + 0.05);

    // Reproduce (spread seeds) if energetic and under carrying capacity.
    const plantCount = this.countSpecies("plant");
    const capOk = this.organisms.length < this.env.carryingCapacity;
    if (
      o.energy >= CONFIG.plantReproEnergy &&
      o.reproCooldown <= 0 &&
      capOk &&
      plantCount < CONFIG.plantCapFraction * this.env.carryingCapacity &&
      this.rng.chance(CONFIG.plantReproChance * o.genome.fertility * this.env.plantGrowthRate)
    ) {
      const angle = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(15, CONFIG.plantSpreadRadius);
      const pos = this.clampPos({
        x: o.pos.x + Math.cos(angle) * r,
        y: o.pos.y + Math.sin(angle) * r,
      });
      const child = crossover(o.genome, o.genome, this.rng);
      const spawned = this.spawn("plant", child, pos, o.generation + 1, [o.id, o.id]);
      if (spawned) {
        o.energy -= CONFIG.plantSeedEnergy;
        o.reproCooldown = 120;
        o.offspringCount++;
        const node = this.lineageById.get(o.id);
        if (node) node.offspring++;
      }
    }
  }

  private stepCreature(o: Organism, isNight: boolean): void {
    // Metabolic drain scaled by body + metabolism + temperature discomfort.
    const tempDiscomfort = Math.abs(this.env.temperature - o.genome.preferredTemp);
    const drain =
      CONFIG.baseMetabolicCost * o.genome.metabolism * o.genome.bodySize * (1 + tempDiscomfort);
    o.energy -= drain;

    // Perceive environment within vision radius.
    const percept = this.perceive(o);

    // Decide action via utility scoring.
    const action = this.decide(o, percept, isNight);
    o.action = action;

    // Execute action -> sets target & velocity intent.
    this.act(o, action, percept);

    // Integrate movement.
    this.integrate(o);

    // Starvation / health coupling.
    if (o.energy <= 0) {
      o.energy = 0;
      o.health -= 0.4;
    } else if (o.energy > o.maxEnergy * 0.5 && o.action === "rest") {
      o.health = Math.min(o.maxHealth, o.health + 0.15);
    }
    // Old age.
    if (o.age > 6000) o.health -= 0.02 * ((o.age - 6000) / 1000);

    if (o.health <= 0) {
      this.kill(o, "natural");
    }
  }

  // ---- Perception -----------------------------------------------------------

  private perceive(o: Organism) {
    const vision = o.genome.visionRadius;
    const v2 = vision * vision;
    let nearestFood: Organism | null = null;
    let nearestFoodD = Infinity;
    let nearestThreat: Organism | null = null;
    let nearestThreatD = Infinity;
    let nearestPrey: Organism | null = null;
    let nearestPreyD = Infinity;
    let nearestMate: Organism | null = null;
    let nearestMateD = Infinity;
    let sameCount = 0;
    // Accumulate same-species center of mass for flocking cohesion.
    let cohX = 0;
    let cohY = 0;

    this.hash.queryRadius(o.pos.x, o.pos.y, vision, (idx) => {
      const other = this.organisms[idx];
      if (other === o || !other.alive) return;
      const d = dist2(o.pos, other.pos);
      if (d > v2) return;

      if (o.species === "herbivore") {
        if (other.species === "plant" && d < nearestFoodD) {
          nearestFoodD = d;
          nearestFood = other;
        } else if (other.species === "predator" && d < nearestThreatD) {
          nearestThreatD = d;
          nearestThreat = other;
        } else if (other.species === "herbivore") {
          sameCount++;
          cohX += other.pos.x;
          cohY += other.pos.y;
          if (
            other.reproCooldown <= 0 &&
            o.reproCooldown <= 0 &&
            d < nearestMateD
          ) {
            nearestMateD = d;
            nearestMate = other;
          }
        }
      } else if (o.species === "predator") {
        if (other.species === "herbivore" && d < nearestPreyD) {
          nearestPreyD = d;
          nearestPrey = other;
        } else if (other.species === "predator") {
          sameCount++;
          cohX += other.pos.x;
          cohY += other.pos.y;
          if (other.reproCooldown <= 0 && o.reproCooldown <= 0 && d < nearestMateD) {
            nearestMateD = d;
            nearestMate = other;
          }
        }
      }
    });

    return {
      nearestFood: nearestFood as Organism | null,
      nearestFoodD: Math.sqrt(nearestFoodD),
      nearestThreat: nearestThreat as Organism | null,
      nearestThreatD: Math.sqrt(nearestThreatD),
      nearestPrey: nearestPrey as Organism | null,
      nearestPreyD: Math.sqrt(nearestPreyD),
      nearestMate: nearestMate as Organism | null,
      nearestMateD: Math.sqrt(nearestMateD),
      sameCount,
      cohesion: sameCount > 0 ? { x: cohX / sameCount, y: cohY / sameCount } : null,
    };
  }

  // ---- Decision (utility AI) ------------------------------------------------

  private decide(
    o: Organism,
    p: ReturnType<World["perceive"]>,
    isNight: boolean,
  ): Action {
    const g = o.genome;
    const energyFrac = o.energy / o.maxEnergy;

    const scores: Record<Action, number> = {
      // Curiosity's behavioural expression lives in `investigate`, not here —
      // giving wander its own curiosity bonus would let it outbid investigate
      // at every curiosity level and make the trait invisible in practice.
      wander: 0.15,
      seekFood: 0,
      seekWater: 0,
      flee: 0,
      chase: 0,
      attack: 0,
      rest: 0,
      mate: 0,
      investigate: 0,
      sleep: 0,
    };

    // Flee dominates when a threat is visible.
    if (p.nearestThreat) {
      const proximity = 1 - Math.min(1, p.nearestThreatD / g.visionRadius);
      scores.flee = (0.5 + g.fear) * (0.4 + proximity);
      o.memory.lastThreatPos = { ...p.nearestThreat.pos };
      o.memory.lastThreatTick = this.tick;
    } else if (o.memory.lastThreatPos) {
      // Residual fear: after a threat leaves vision, fearful organisms keep
      // some flee urgency toward its last known position for a while longer
      // than bold ones do. Without this, fear only matters in the narrow
      // instant before a threat crosses the hard vision-radius cutoff, which
      // makes the trait nearly invisible in practice.
      const age = this.tick - o.memory.lastThreatTick;
      const window = CONFIG.threatMemoryTicks * (0.2 + g.fear);
      if (age < window) {
        scores.flee = g.fear * 0.55 * (1 - age / window);
      }
    }

    // Hunger.
    const hunger = 1 - energyFrac;
    if (o.species === "herbivore" && p.nearestFood) {
      scores.seekFood = hunger * 1.2;
    }
    if (o.species === "predator" && p.nearestPrey) {
      const proximity = 1 - Math.min(1, p.nearestPreyD / g.visionRadius);
      scores.chase = (0.4 + g.aggression) * (0.3 + hunger) * (0.5 + proximity);
      if (p.nearestPreyD < CONFIG.attackRadius && o.attackCooldown <= 0) {
        scores.attack = scores.chase + 0.5;
      }
    }

    // Rest when safe and low energy but not starving-desperate.
    if (!p.nearestThreat && energyFrac < 0.35) {
      scores.rest = 0.3 + (0.35 - energyFrac);
    }

    // Sleep at night.
    if (isNight && !p.nearestThreat) {
      scores.sleep = g.sleepTendency * (0.4 + (energyFrac > 0.3 ? 0.3 : 0));
    }

    // Mate when well-fed and a partner is near.
    if (
      p.nearestMate &&
      energyFrac >= CONFIG.reproMinEnergyFrac &&
      o.reproCooldown <= 0 &&
      this.organisms.length < this.env.carryingCapacity
    ) {
      scores.mate = g.fertility * 0.9 * energyFrac;
    }

    // Investigate novelty when curious and otherwise idle.
    if (o.memory.lastFoodPos && this.tick - o.memory.lastFoodTick < CONFIG.memoryDecayTicks) {
      scores.investigate = g.curiosity * 0.35;
    }

    // Pick highest.
    let best: Action = "wander";
    let bestScore = -Infinity;
    for (const k in scores) {
      const s = scores[k as Action];
      if (s > bestScore) {
        bestScore = s;
        best = k as Action;
      }
    }
    return best;
  }

  // ---- Action execution -----------------------------------------------------

  private act(o: Organism, action: Action, p: ReturnType<World["perceive"]>): void {
    const g = o.genome;
    const speed = CONFIG.maxSpeedBase * g.movementSpeed;

    switch (action) {
      case "flee": {
        const from = p.nearestThreat?.pos ?? o.memory.lastThreatPos;
        if (from) {
          const dx = o.pos.x - from.x;
          const dy = o.pos.y - from.y;
          // Fearful organisms sprint harder; bold ones flee at a more measured
          // pace (and pay less of an energy cost for it — see integrate()).
          const urgency = 0.6 + g.fear * 0.8;
          this.steer(o, dx, dy, speed * CONFIG.fleeMultiplier * urgency);
        }
        break;
      }
      case "seekFood": {
        if (p.nearestFood) {
          if (p.nearestFoodD < CONFIG.eatRadius) {
            this.eatPlant(o, p.nearestFood);
            o.vel.x *= 0.5;
            o.vel.y *= 0.5;
          } else {
            this.seek(o, p.nearestFood.pos, speed);
            o.memory.lastFoodPos = { ...p.nearestFood.pos };
            o.memory.lastFoodTick = this.tick;
          }
        }
        break;
      }
      case "chase": {
        // Aggression scales pursuit speed, not just the decision to chase —
        // otherwise it only shifts a scoring threshold that's rarely binding
        // (chase tends to beat wander for any aggression once prey is
        // visible), leaving the trait with no real physical effect.
        if (p.nearestPrey) this.seek(o, p.nearestPrey.pos, speed * (0.85 + g.aggression * 0.5));
        break;
      }
      case "attack": {
        if (p.nearestPrey) {
          this.seek(o, p.nearestPrey.pos, speed);
          if (p.nearestPreyD < CONFIG.attackRadius && o.attackCooldown <= 0) {
            this.attack(o, p.nearestPrey);
          }
        }
        break;
      }
      case "mate": {
        if (p.nearestMate) {
          if (p.nearestMateD < CONFIG.matingRadius) {
            this.reproduce(o, p.nearestMate);
          } else {
            this.seek(o, p.nearestMate.pos, speed);
          }
        }
        break;
      }
      case "rest":
      case "sleep": {
        o.vel.x *= 0.85;
        o.vel.y *= 0.85;
        o.energy = Math.min(o.maxEnergy, o.energy + 0.01);
        break;
      }
      case "investigate": {
        if (o.memory.lastFoodPos) this.seek(o, o.memory.lastFoodPos, speed * 0.7);
        break;
      }
      case "wander":
      default: {
        // Flocking cohesion: sociable organisms steer toward the same-species
        // center of mass, same mechanism `seek` uses for food/mates (not a
        // weak positional nudge, which gets lost in wander jitter). This
        // makes `sociability` a measurable behaviour and raises
        // mating-encounter rates so prey can sustain a breeding base.
        let cohesionWeight = 0;
        if (p.cohesion) {
          const energyFrac = o.energy / o.maxEnergy;
          // Reproductively-ready organisms seek company harder (to find a mate).
          const ready = energyFrac >= CONFIG.reproMinEnergyFrac && o.reproCooldown <= 0;
          cohesionWeight = Math.min(0.9, g.sociability * 0.7 + (ready ? 0.3 : 0));
          const dx = p.cohesion.x - o.pos.x;
          const dy = p.cohesion.y - o.pos.y;
          const d = Math.hypot(dx, dy);
          if (cohesionWeight > 0.05 && d > 20) {
            this.steer(o, dx, dy, speed * 0.7 * cohesionWeight);
          }
        }

        // Random-walk jitter fills in the rest, scaled down for organisms
        // strongly committed to flocking so cohesion isn't drowned out.
        const jitter = CONFIG.wanderJitter * (1 - cohesionWeight * 0.6);
        o.vel.x += this.rng.range(-jitter, jitter);
        o.vel.y += this.rng.range(-jitter, jitter);

        const sp = Math.hypot(o.vel.x, o.vel.y) || 1;
        const cap = speed * 0.6;
        if (sp > cap) {
          o.vel.x = (o.vel.x / sp) * cap;
          o.vel.y = (o.vel.y / sp) * cap;
        }
        break;
      }
    }
  }

  private seek(o: Organism, target: Vec2, speed: number): void {
    o.target = target;
    this.steer(o, target.x - o.pos.x, target.y - o.pos.y, speed);
  }

  private steer(o: Organism, dx: number, dy: number, speed: number): void {
    const d = Math.hypot(dx, dy) || 1;
    const desiredX = (dx / d) * speed;
    const desiredY = (dy / d) * speed;
    // Simple steering toward desired velocity.
    o.vel.x += (desiredX - o.vel.x) * 0.25;
    o.vel.y += (desiredY - o.vel.y) * 0.25;
  }

  private integrate(o: Organism): void {
    const speed = Math.hypot(o.vel.x, o.vel.y);
    const cap = CONFIG.maxSpeedBase * o.genome.movementSpeed;
    if (speed > cap) {
      o.vel.x = (o.vel.x / speed) * cap;
      o.vel.y = (o.vel.y / speed) * cap;
    }
    o.pos.x += o.vel.x;
    o.pos.y += o.vel.y;

    // Movement energy cost.
    o.energy -= speed * CONFIG.moveCostFactor * o.genome.metabolism;

    // Bounce off world edges.
    if (o.pos.x < 4) {
      o.pos.x = 4;
      o.vel.x = Math.abs(o.vel.x) * 0.5;
    } else if (o.pos.x > CONFIG.worldWidth - 4) {
      o.pos.x = CONFIG.worldWidth - 4;
      o.vel.x = -Math.abs(o.vel.x) * 0.5;
    }
    if (o.pos.y < 4) {
      o.pos.y = 4;
      o.vel.y = Math.abs(o.vel.y) * 0.5;
    } else if (o.pos.y > CONFIG.worldHeight - 4) {
      o.pos.y = CONFIG.worldHeight - 4;
      o.vel.y = -Math.abs(o.vel.y) * 0.5;
    }
  }

  private eatPlant(o: Organism, plant: Organism): void {
    if (!plant.alive) return;
    const gained = Math.min(plant.energy, CONFIG.plantEnergyValue);
    o.energy = Math.min(o.maxEnergy, o.energy + gained);
    plant.energy -= gained;
    o.memory.lastFoodPos = { ...plant.pos };
    o.memory.lastFoodTick = this.tick;
    if (plant.energy <= 1) this.kill(plant, "eaten");
  }

  private attack(o: Organism, prey: Organism): void {
    o.attackCooldown = CONFIG.attackCooldownTicks;
    prey.health -= CONFIG.attackDamage * o.genome.bodySize;
    prey.memory.lastThreatPos = { ...o.pos };
    prey.memory.lastThreatTick = this.tick;
    if (prey.health <= 0) {
      const gain = prey.energy * CONFIG.preyEnergyGain + prey.maxEnergy * 0.15;
      o.energy = Math.min(o.maxEnergy, o.energy + gain);
      this.kill(prey, "predated");
    }
  }

  private reproduce(a: Organism, b: Organism): void {
    if (this.organisms.length >= this.env.carryingCapacity) return;
    if (a.reproCooldown > 0 || b.reproCooldown > 0) return;
    const childGenome = crossover(a.genome, b.genome, this.rng);
    const pos = this.clampPos({
      x: (a.pos.x + b.pos.x) / 2 + this.rng.range(-10, 10),
      y: (a.pos.y + b.pos.y) / 2 + this.rng.range(-10, 10),
    });
    const gen = Math.max(a.generation, b.generation) + 1;
    const child = this.spawn(a.species, childGenome, pos, gen, [a.id, b.id]);
    if (child) {
      const cost = a.maxEnergy * CONFIG.reproCostFrac;
      a.energy -= cost;
      b.energy -= b.maxEnergy * CONFIG.reproCostFrac;
      a.reproCooldown = CONFIG.reproCooldownTicks;
      b.reproCooldown = CONFIG.reproCooldownTicks;
      a.offspringCount++;
      b.offspringCount++;
      const na = this.lineageById.get(a.id);
      const nb = this.lineageById.get(b.id);
      if (na) na.offspring++;
      if (nb) nb.offspring++;
    }
  }

  kill(o: Organism, _cause: string): void {
    if (!o.alive) return;
    o.alive = false;
    o.health = 0;
    const node = this.lineageById.get(o.id);
    if (node && node.diedTick == null) node.diedTick = this.tick;
    if (this.ascendedId === o.id) this.ascendedId = null;
  }

  private compact(): void {
    let w = 0;
    for (let i = 0; i < this.organisms.length; i++) {
      if (this.organisms[i].alive) {
        this.organisms[w++] = this.organisms[i];
      }
    }
    this.organisms.length = w;
  }

  // ---- Analytics ------------------------------------------------------------

  countSpecies(s: Species): number {
    let c = 0;
    for (const o of this.organisms) if (o.alive && o.species === s) c++;
    return c;
  }

  private sample(): void {
    let plants = 0;
    let herb = 0;
    let pred = 0;
    let genSum = 0;
    let n = 0;
    for (const o of this.organisms) {
      if (!o.alive) continue;
      if (o.species === "plant") plants++;
      else if (o.species === "herbivore") herb++;
      else pred++;
      genSum += o.generation;
      n++;
    }
    this.history.push({
      tick: this.tick,
      plants,
      herbivores: herb,
      predators: pred,
      avgGeneration: n ? genSum / n : 0,
      temperature: this.env.temperature,
      moisture: this.env.moisture,
    });
    if (this.history.length > CONFIG.maxHistorySamples) this.history.shift();
  }

  /** Average genome across living non-plant organisms (dominant traits). */
  dominantTraits(): Partial<Genome> | null {
    let n = 0;
    const acc: Record<string, number> = {};
    for (const o of this.organisms) {
      if (!o.alive || o.species === "plant") continue;
      n++;
      for (const k in o.genome) acc[k] = (acc[k] ?? 0) + (o.genome as any)[k];
    }
    if (!n) return null;
    const out: Record<string, number> = {};
    for (const k in acc) out[k] = acc[k] / n;
    return out as Partial<Genome>;
  }

  private maybeAutoAscend(): void {
    if (this.ascendedId != null) {
      const cur = this.organisms.find((o) => o.id === this.ascendedId && o.alive);
      if (cur) return;
      this.ascendedId = null;
    }
    // Auto-nominate a resilient elder if none chosen.
    let best: Organism | null = null;
    let bestScore = -Infinity;
    for (const o of this.organisms) {
      if (!o.alive || o.species === "plant") continue;
      if (o.generation < CONFIG.ascendMinGeneration && o.age < CONFIG.ascendMinAge) continue;
      const score = o.generation * 100 + o.age * 0.05 + o.offspringCount * 40;
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (best) this.ascendedId = best.id;
  }

  ascend(id: number): boolean {
    const o = this.organisms.find((x) => x.id === id && x.alive);
    if (!o || o.species === "plant") return false;
    this.ascendedId = id;
    return true;
  }

  getById(id: number): Organism | undefined {
    return this.organisms.find((o) => o.id === id);
  }

  // ---- Serialization --------------------------------------------------------

  snapshot(): WorldSnapshot {
    return {
      version: SAVE_VERSION,
      seed: this.seed,
      tick: this.tick,
      nextId: this.nextId,
      rngState: this.rng.getState(),
      organisms: this.organisms.filter((o) => o.alive).map((o) => structuredCloneSafe(o)),
      environment: { ...this.env },
      interventions: this.interventions.slice(-500),
      history: this.history.slice(),
      lineage: this.lineage.slice(-2000),
      ascendedId: this.ascendedId,
    };
  }

  static fromSnapshot(snap: WorldSnapshot): World {
    const w = Object.create(World.prototype) as World;
    w.seed = snap.seed;
    w.tick = snap.tick;
    w.nextId = snap.nextId;
    w.rng = new Rng(snap.seed);
    w.rng.setState(snap.rngState);
    w.organisms = snap.organisms.map((o) => structuredCloneSafe(o));
    w.env = { ...snap.environment };
    w.interventions = snap.interventions.slice();
    w.history = snap.history.slice();
    w.lineage = snap.lineage.slice();
    w.lineageById = new Map();
    for (const n of w.lineage) w.lineageById.set(n.id, n);
    w.ascendedId = snap.ascendedId;
    w.hash = new SpatialHash(CONFIG.worldWidth, CONFIG.worldHeight, CONFIG.cellSize);
    w.scratchNeighbors = [];
    return w;
  }
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
