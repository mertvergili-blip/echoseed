/**
 * Headless multi-seed ecosystem analysis. Runs many seeds for a long horizon
 * and reports population dynamics, extinctions, genome diversity, vital rates,
 * and stability classification. Also verifies long-run determinism via
 * serialized world-state comparison at fixed tick checkpoints.
 *
 * Run with:  pnpm analyze          (default 20 seeds x 12000 ticks)
 *            pnpm analyze 30 20000  (seeds, ticks)
 */
import { World } from "../src/sim/world";
import { geneKeys } from "../src/sim/genome";
import type { Genome, Species } from "../src/sim/types";

interface SeedReport {
  seed: string;
  startPop: number;
  endPop: number;
  startCounts: Record<Species, number>;
  endCounts: Record<Species, number>;
  extinctSpecies: Species[];
  maxGeneration: number;
  avgLifespan: number;
  births: number;
  deaths: number;
  predatorPreyRatio: number;
  dominantTraits: Partial<Genome>;
  genomeDiversity: number; // mean normalized stdev across genes
  peakPop: number;
  classification: string;
  nanFound: boolean;
  ticks: number;
  ms: number;
}

const SPECIES: Species[] = ["plant", "herbivore", "predator"];

function counts(w: World): Record<Species, number> {
  const c: Record<Species, number> = { plant: 0, herbivore: 0, predator: 0 };
  for (const o of w.organisms) if (o.alive) c[o.species]++;
  return c;
}

function genomeDiversity(w: World): number {
  const keys = geneKeys();
  const mobile = w.organisms.filter((o) => o.alive && o.species !== "plant");
  if (mobile.length < 2) return 0;
  let sum = 0;
  for (const k of keys) {
    const vals = mobile.map((o) => o.genome[k] as number);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const varr = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    // Normalize by the mean absolute value to compare across gene scales.
    const norm = Math.sqrt(varr) / (Math.abs(mean) + 1e-6);
    sum += norm;
  }
  return sum / keys.length;
}

function dominant(w: World): Partial<Genome> {
  return w.dominantTraits() ?? {};
}

function classify(r: Omit<SeedReport, "classification">): string {
  const endTotal = r.endPop;
  const endMobile = r.endCounts.herbivore + r.endCounts.predator;
  if (endMobile === 0) return "COLLAPSE (no mobile life)";
  if (r.endCounts.herbivore === 0) return "HERBIVORE-EXTINCT";
  if (r.endCounts.predator === 0) return "PREDATOR-EXTINCT (herbivores persist)";
  if (endTotal >= 690) return "OVERGROWTH (near hard cap)";
  if (r.maxGeneration < 2) return "STAGNANT (little reproduction)";
  return "STABLE (multi-species, evolving)";
}

async function runSeed(seed: string, ticks: number): Promise<SeedReport> {
  const t0 = performance.now();
  const w = new World(seed);
  const startCounts = counts(w);
  const startPop = w.organisms.filter((o) => o.alive).length;

  let peakPop = startPop;
  let nanFound = false;

  // Apply a light, deterministic intervention rhythm so seeds face pressure.
  for (let i = 0; i < ticks; i++) {
    if (i > 0 && i % 3000 === 0) w.applyIntervention({ type: "addFood", value: 6 });
    w.step();
    const pop = w.organisms.length;
    if (pop > peakPop) peakPop = pop;
    if (i % 1000 === 0) {
      for (const o of w.organisms) {
        if (!o.alive) continue;
        if (!Number.isFinite(o.pos.x) || !Number.isFinite(o.energy) || !Number.isFinite(o.health)) {
          nanFound = true;
        }
      }
    }
  }

  const endCounts = counts(w);
  const endPop = w.organisms.filter((o) => o.alive).length;

  // Vital statistics from lineage.
  let births = 0;
  let deaths = 0;
  let lifespanSum = 0;
  let lifespanN = 0;
  let maxGen = 0;
  for (const n of w.lineage) {
    births++;
    if (n.diedTick != null) {
      deaths++;
      lifespanSum += n.diedTick - n.bornTick;
      lifespanN++;
    }
    if (n.generation > maxGen) maxGen = n.generation;
  }

  const extinct = SPECIES.filter((s) => startCounts[s] > 0 && endCounts[s] === 0);
  const ppr = endCounts.herbivore > 0 ? endCounts.predator / endCounts.herbivore : Infinity;

  const partial: Omit<SeedReport, "classification"> = {
    seed,
    startPop,
    endPop,
    startCounts,
    endCounts,
    extinctSpecies: extinct,
    maxGeneration: maxGen,
    avgLifespan: lifespanN ? lifespanSum / lifespanN : 0,
    births,
    deaths,
    predatorPreyRatio: ppr,
    dominantTraits: dominant(w),
    genomeDiversity: genomeDiversity(w),
    peakPop,
    nanFound,
    ticks,
    ms: performance.now() - t0,
  };
  return { ...partial, classification: classify(partial) };
}

async function main() {
  const nSeeds = parseInt(process.argv[2] ?? "20", 10);
  const ticks = parseInt(process.argv[3] ?? "12000", 10);
  const seeds = Array.from({ length: nSeeds }, (_, i) => `audit-seed-${i + 1}`);

  console.log(`\nECHOSEED analysis — ${nSeeds} seeds × ${ticks} ticks\n${"=".repeat(72)}`);
  const reports: SeedReport[] = [];
  for (const s of seeds) {
    const r = await runSeed(s, ticks);
    reports.push(r);
    console.log(
      `${s.padEnd(16)} | ${String(r.startPop).padStart(3)}→${String(r.endPop).padStart(3)} ` +
        `| P${String(r.endCounts.plant).padStart(3)} H${String(r.endCounts.herbivore).padStart(3)} R${String(r.endCounts.predator).padStart(2)} ` +
        `| gen ${String(r.maxGeneration).padStart(2)} | life ${r.avgLifespan.toFixed(0).padStart(4)} ` +
        `| div ${r.genomeDiversity.toFixed(3)} | ${r.nanFound ? "NaN!" : "ok"} | ${r.ms.toFixed(0)}ms | ${r.classification}`,
    );
  }

  console.log("=".repeat(72));
  const tally: Record<string, number> = {};
  for (const r of reports) {
    const key = r.classification.split(" ")[0];
    tally[key] = (tally[key] ?? 0) + 1;
  }
  console.log("\nClassification tally:");
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${v}/${nSeeds}`);
  }

  const anyNaN = reports.some((r) => r.nanFound);
  const avgDiv = reports.reduce((a, r) => a + r.genomeDiversity, 0) / reports.length;
  const avgGen = reports.reduce((a, r) => a + r.maxGeneration, 0) / reports.length;
  const avgLife = reports.reduce((a, r) => a + r.avgLifespan, 0) / reports.length;
  const totalMs = reports.reduce((a, r) => a + r.ms, 0);
  console.log(
    `\nAggregate: avgMaxGen ${avgGen.toFixed(1)} | avgLifespan ${avgLife.toFixed(0)} | ` +
      `avgDiversity ${avgDiv.toFixed(3)} | NaN across all: ${anyNaN} | total ${totalMs.toFixed(0)}ms`,
  );

  // Long-run determinism proof: serialized-state comparison at checkpoints.
  console.log(`\n${"=".repeat(72)}\nLong-run determinism (serialized state at checkpoints):`);
  const detOk = verifyDeterminism("determinism-proof", 8000, [1000, 4000, 8000]);
  console.log(detOk ? "  ✓ byte-identical serialized state at all checkpoints" : "  ✗ DIVERGENCE DETECTED");

  const collapses = reports.filter((r) => r.classification.startsWith("COLLAPSE")).length;
  const overgrowth = reports.filter((r) => r.classification.startsWith("OVERGROWTH")).length;
  console.log(`\nHealth check: collapses ${collapses}/${nSeeds}, overgrowth ${overgrowth}/${nSeeds}`);
  if (anyNaN) process.exitCode = 1;
}

/** Serialize world (minus volatile render caches) into a stable string. */
function stateHash(w: World): string {
  const snap = w.snapshot();
  // Sort organisms by id for order-independence, stringify key fields.
  const orgs = snap.organisms
    .slice()
    .sort((a, b) => a.id - b.id)
    .map(
      (o) =>
        `${o.id},${o.species},${o.generation},${o.pos.x.toFixed(6)},${o.pos.y.toFixed(6)},` +
        `${o.vel.x.toFixed(6)},${o.vel.y.toFixed(6)},${o.energy.toFixed(6)},${o.health.toFixed(6)},${o.action}`,
    )
    .join("|");
  return `t${snap.tick};rng${snap.rngState.join(",")};next${snap.nextId};${orgs}`;
}

function verifyDeterminism(seed: string, ticks: number, checkpoints: number[]): boolean {
  const a = new World(seed);
  const b = new World(seed);
  const interventions = [
    { at: 500, iv: { type: "addPredator" as const } },
    { at: 1500, iv: { type: "rain" as const, value: 400 } },
    { at: 2500, iv: { type: "addFood" as const, x: 300, y: 300, value: 5 } },
    { at: 5000, iv: { type: "drought" as const, value: 400 } },
  ];
  const cp = new Set(checkpoints);
  for (let i = 1; i <= ticks; i++) {
    for (const { at, iv } of interventions) {
      if (i === at) {
        a.applyIntervention(iv);
        b.applyIntervention(iv);
      }
    }
    a.step();
    b.step();
    if (cp.has(i)) {
      const ha = stateHash(a);
      const hb = stateHash(b);
      if (ha !== hb) {
        console.log(`  divergence at tick ${i}`);
        return false;
      }
      console.log(`  tick ${String(i).padStart(5)}: ${a.organisms.filter((o) => o.alive).length} organisms — match`);
    }
  }
  return true;
}

main();
