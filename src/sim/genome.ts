import { Rng } from "./rng";
import type { Genome } from "./types";

/** [min, max] valid range for each gene. Mutations are clamped here. */
export const GENOME_RANGES: Record<keyof Genome, [number, number]> = {
  bodySize: [0.5, 2],
  movementSpeed: [0.4, 2],
  visionRadius: [20, 160],
  metabolism: [0.5, 2],
  aggression: [0, 1],
  fear: [0, 1],
  curiosity: [0, 1],
  sociability: [0, 1],
  fertility: [0, 1],
  mutationRate: [0, 0.5],
  sleepTendency: [0, 1],
  preferredTemp: [0, 1],
  visualHue: [0, 360],
  bodyProportion: [0.5, 1.5],
};

const GENE_KEYS = Object.keys(GENOME_RANGES) as (keyof Genome)[];

function clampGene(key: keyof Genome, v: number): number {
  const [min, max] = GENOME_RANGES[key];
  if (Number.isNaN(v)) return (min + max) / 2;
  return Math.max(min, Math.min(max, v));
}

/** Species-flavoured random starting genome. */
export function randomGenome(rng: Rng, species: "plant" | "herbivore" | "predator"): Genome {
  const g: Genome = {
    bodySize: rng.range(0.7, 1.4),
    movementSpeed: rng.range(0.6, 1.4),
    visionRadius: rng.range(40, 110),
    metabolism: rng.range(0.7, 1.3),
    aggression: rng.range(0, 0.4),
    fear: rng.range(0.3, 0.8),
    curiosity: rng.range(0.2, 0.8),
    sociability: rng.range(0.2, 0.8),
    fertility: rng.range(0.3, 0.8),
    mutationRate: rng.range(0.02, 0.12),
    sleepTendency: rng.range(0.3, 0.8),
    preferredTemp: rng.range(0.35, 0.65),
    visualHue: rng.range(0, 360),
    bodyProportion: rng.range(0.7, 1.3),
  };

  if (species === "predator") {
    g.aggression = rng.range(0.55, 0.95);
    g.fear = rng.range(0.05, 0.35);
    g.movementSpeed = rng.range(1.0, 1.8);
    g.bodySize = rng.range(1.0, 1.7);
    g.visionRadius = rng.range(80, 160);
    g.visualHue = rng.range(340, 380) % 360; // reds/magentas
    g.metabolism = rng.range(0.75, 1.2);
  } else if (species === "herbivore") {
    g.aggression = rng.range(0, 0.25);
    g.fear = rng.range(0.4, 0.9);
    g.sociability = rng.range(0.4, 0.9);
    g.visualHue = rng.range(150, 210); // teal/cyan
  } else {
    // plant
    g.movementSpeed = 0;
    g.aggression = 0;
    g.fear = 0;
    g.curiosity = 0;
    g.visionRadius = 0;
    g.fertility = rng.range(0.4, 0.9);
    g.visualHue = rng.range(80, 140); // green
    g.bodySize = rng.range(0.6, 1.2);
  }

  for (const k of GENE_KEYS) g[k] = clampGene(k, g[k] as number);
  return g;
}

/**
 * Combine two parent genomes. Each gene is blended (weighted random mix),
 * then subject to a small mutation with occasional larger jumps.
 */
export function crossover(a: Genome, b: Genome, rng: Rng): Genome {
  const child = {} as Genome;
  const rate = (a.mutationRate + b.mutationRate) / 2;

  for (const k of GENE_KEYS) {
    // Blend: pick a mixing weight per-gene so offspring aren't just midpoints.
    const w = rng.next();
    let v = (a[k] as number) * w + (b[k] as number) * (1 - w);

    if (rng.chance(rate)) {
      const [min, max] = GENOME_RANGES[k];
      const span = max - min;
      if (rng.chance(0.12)) {
        // Rare large mutation.
        v += rng.gaussian(0, span * 0.3);
      } else {
        // Common small mutation.
        v += rng.gaussian(0, span * 0.05);
      }
    }
    child[k] = clampGene(k, v) as never;
  }
  return child;
}

/** Force a mutation on an existing genome (user "Create random mutation"). */
export function forceMutate(g: Genome, rng: Rng, strength = 0.3): Genome {
  const out = { ...g };
  const key = rng.pick(GENE_KEYS);
  const [min, max] = GENOME_RANGES[key];
  const span = max - min;
  out[key] = clampGene(key, (g[key] as number) + rng.gaussian(0, span * strength)) as never;
  return out;
}

/** Simple genetic distance for lineage/dominant-trait analysis. */
export function geneKeys(): (keyof Genome)[] {
  return GENE_KEYS.slice();
}
