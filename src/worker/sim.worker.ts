/// <reference lib="webworker" />
import { World } from "../sim/world";
import { ACTION_INDEX, SPECIES_INDEX } from "../sim/protocol";
import type { ToWorker, FromWorker, FrameData, RenderOrganism } from "../sim/protocol";

let world: World | null = null;
let speed = 1;
let paused = false;
let background = false;

let tickAccumulator = 0;
let lastFrameTime = 0;
let tpsCounter = 0;
let tpsWindowStart = 0;
let currentTps = 0;

const FRAME_MS = 1000 / 30; // render/frame push cadence target
const TICK_MS = 1000 / 30; // base sim rate (one tick per ~33ms at 1x)

function post(msg: FromWorker) {
  (self as unknown as Worker).postMessage(msg);
}

function buildFrame(): FrameData {
  const w = world!;
  const organisms: RenderOrganism[] = [];
  let plants = 0;
  let herb = 0;
  let pred = 0;
  let genSum = 0;
  let n = 0;
  for (const o of w.organisms) {
    if (!o.alive) continue;
    if (o.species === "plant") plants++;
    else if (o.species === "herbivore") herb++;
    else pred++;
    genSum += o.generation;
    n++;
    organisms.push({
      id: o.id,
      species: SPECIES_INDEX[o.species],
      x: o.pos.x,
      y: o.pos.y,
      vx: o.vel.x,
      vy: o.vel.y,
      hue: o.genome.visualHue,
      size: o.genome.bodySize,
      proportion: o.genome.bodyProportion,
      energyFrac: o.maxEnergy > 0 ? o.energy / o.maxEnergy : 0,
      healthFrac: o.maxHealth > 0 ? o.health / o.maxHealth : 0,
      action: ACTION_INDEX[o.action] ?? 0,
      generation: o.generation,
      ascended: w.ascendedId === o.id,
    });
  }
  return {
    tick: w.tick,
    organisms,
    env: { ...w.env },
    counts: { plants, herbivores: herb, predators: pred },
    avgGeneration: n ? genSum / n : 0,
    ascendedId: w.ascendedId,
    tps: currentTps,
    dominantTraits: w.dominantTraits(),
  };
}

function loop(now: number) {
  if (!world) {
    scheduleNext();
    return;
  }
  if (lastFrameTime === 0) lastFrameTime = now;
  const dt = now - lastFrameTime;
  lastFrameTime = now;

  if (!paused) {
    // Number of ticks to run this frame based on speed multiplier.
    const effectiveSpeed = background ? Math.min(speed, 2) : speed;
    tickAccumulator += (dt / TICK_MS) * effectiveSpeed;
    // Cap catch-up to avoid spiral-of-death after tab throttling.
    let budget = Math.min(tickAccumulator, effectiveSpeed * 4 + 4);
    while (budget >= 1) {
      world.step();
      budget -= 1;
      tickAccumulator -= 1;
      tpsCounter++;
    }
    if (tickAccumulator > 100) tickAccumulator = 0;
  }

  // TPS measurement window.
  if (tpsWindowStart === 0) tpsWindowStart = now;
  if (now - tpsWindowStart >= 500) {
    currentTps = Math.round((tpsCounter * 1000) / (now - tpsWindowStart));
    tpsCounter = 0;
    tpsWindowStart = now;
  }

  post({ type: "frame", data: buildFrame() });
  scheduleNext();
}

let timer: ReturnType<typeof setTimeout> | null = null;
function scheduleNext() {
  const interval = background ? 200 : FRAME_MS;
  timer = setTimeout(() => loop(performance.now()), interval);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "init":
      world = new World(msg.seed);
      lastFrameTime = 0;
      tickAccumulator = 0;
      post({ type: "ready" });
      post({ type: "history", history: world.history });
      break;
    case "loadSnapshot":
      world = World.fromSnapshot(msg.snapshot);
      lastFrameTime = 0;
      tickAccumulator = 0;
      post({ type: "ready" });
      post({ type: "history", history: world.history });
      break;
    case "setSpeed":
      speed = msg.speed;
      break;
    case "pause":
      paused = msg.paused;
      break;
    case "setBackground":
      background = msg.background;
      break;
    case "intervene":
      if (world) {
        world.applyIntervention(msg.intervention);
        post({ type: "history", history: world.history });
      }
      break;
    case "ascend":
      if (world) world.ascend(msg.id);
      break;
    case "requestSnapshot":
      if (world) post({ type: "snapshot", token: msg.token, snapshot: world.snapshot() });
      break;
    case "requestFullOrganism":
      if (world) {
        const o = world.getById(msg.id) ?? null;
        post({ type: "organism", organism: o });
        post({ type: "lineage", lineage: world.lineage });
      }
      break;
  }
};

scheduleNext();
