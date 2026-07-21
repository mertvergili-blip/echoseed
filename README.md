# ECHOSEED

**A living artificial ecosystem in a jar — and an evolved creature that walks out onto your desktop.**

ECHOSEED is a deterministic, seed-based ecosystem simulation. Plants, herbivores,
and predators are born, hunt, flee, mate, mutate, and die inside a dark
bio-luminescent terrarium. When a lineage proves resilient enough, one organism
can **ascend** into a small, transparent, always-on-top desktop companion that
carries its own inherited genome, needs, and moods — sharing the exact same saved
world as the terrarium.

Built with **Tauri 2 · React · TypeScript · Vite · PixiJS 8 · Web Worker ·
Tauri Store**. No external AI APIs, no paid services, no required internet
connection. Everything runs locally and offline.

---

## Two views, one world

| View | What it is |
| --- | --- |
| **Terrarium** | The full ecosystem in a normal window: simulation controls, inspector, genome visualization, lineage, graphs, event log, interventions. |
| **Desktop Creature** | An *ascended* organism living in a tiny frameless transparent always-on-top window. It wanders your screen, sleeps by the clock, and responds to Feed / Pet / Sleep. |

Both read and write the **same persisted save** (world seed, organisms, genomes,
lineage, environment, sim time, intervention history, ascended creature, creature
mood/needs, settings, window position).

---

## Quick start (browser version — always works)

Requirements: **Node 18+** and **pnpm** (or npm).

```bash
pnpm install
pnpm dev            # http://localhost:1420
```

Then open the printed URL. Use the **"Desktop Creature"** button in the left
panel to spawn the creature in a popup window (in the browser build it's a popup;
in the Tauri build it's a real transparent OS window).

Production browser build:

```bash
pnpm build          # outputs to dist/
pnpm preview        # serve the built bundle
```

---

## Desktop app (Tauri)

Additional requirements:

- **Rust** + **Cargo** (https://rustup.rs)
- **Windows**: Microsoft C++ Build Tools + WebView2 (preinstalled on Win 11)
- **Linux**: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`
- **macOS**: Xcode command line tools

Run in development (hot-reloading desktop window):

```bash
pnpm tauri:dev
```

Build the desktop application:

```bash
pnpm tauri:build
```

### Windows installer

On a Windows machine (or a Windows CI runner), `pnpm tauri:build` produces:

```
src-tauri/target/release/echoseed.exe                       # the app
src-tauri/target/release/bundle/msi/ECHOSEED_0.1.0_x64_en-US.msi
src-tauri/target/release/bundle/nsis/ECHOSEED_0.1.0_x64-setup.exe
```

> Cross-compiling a Windows installer from Linux/macOS is not supported by Tauri;
> build on Windows for the `.msi` / `.exe`. The bundle targets are already
> configured in `src-tauri/tauri.conf.json`.

---

## Controls

**Terrarium**
- **Play / Pause**, speed **1× / 2× / 4× / 8× / 16×**
- **Click** an organism to select & inspect it; **● follow** makes the camera track it
- **Scroll** to zoom, **right-drag** to pan, **shift-click** to drop food
- **Interventions**: Add Food, +Herbivore, +Predator, Trigger Rain, Drought,
  Cold Period, Temperature slider
- **Inspector**: genome bars, health/energy, action, full lineage; **Ascend**,
  **Mutate**, **Remove**
- **Graphs**: population history + species-ratio; **Event Log**; **Dominant Traits**
- **Save**, **Reset ⟳** (new seed). Autosaves every 15 s.
- **Debug** toggle shows render FPS and simulation ticks/second

**Desktop Creature**
- **Drag** it around (moves the OS window in Tauri; moves the creature in-canvas
  in the browser)
- **Right-click** for the menu: **Feed**, **Pet**, **Sleep**, **Return to
  Terrarium**, **Open Terrarium**
- It sleeps at night (22:00–07:00 local) and when tired, plays when curious, and
  drifts around on its own when left alone.

---

## How the simulation works

- **Determinism**: all randomness flows through one seeded `sfc32` PRNG whose
  state is saved. Same seed + same interventions ⇒ byte-identical replay.
- **Organisms** carry id, species, generation, parent ids, age, health, energy,
  position/velocity/target, current action, a 14-gene genome, and short-term
  memory.
- **Behaviour** is a utility-AI: each tick every creature scores `wander`,
  `seekFood`, `flee`, `chase`, `attack`, `rest`, `mate`, `investigate`, `sleep`
  using only what's inside its **vision radius** (spatial-hash neighbour queries).
- **Genetics**: two-parent crossover blends each gene independently, with a small
  per-gene mutation chance and rarer large mutations, all clamped to valid ranges.
  There is no single "perfect" genome — trait value depends on the environment.
- **Environment**: day/night cycle, diurnal + seasonal temperature, moisture,
  plant growth tied to climate, carrying capacity, and weather events (rain,
  drought, cold).
- **Performance**: the simulation runs entirely in a **Web Worker**, decoupled
  from rendering; spatial hashing keeps perception near-linear; scratch buffers
  limit allocation; background tabs throttle the tick rate. Target: ~500
  organisms at interactive speed.

## Architecture

```
src/
  sim/         deterministic engine (rng, genome, spatial hash, world, save, types, protocol)
  worker/      sim.worker.ts — runs the World off the main thread
  render/      renderer.ts — PixiJS procedural terrarium renderer
  app/         React terrarium UI (App, SimClient, components)
  creature/    desktop-creature engine + canvas renderer
  platform/    storage adapter (Tauri Store ↔ localStorage) + creature window
  main.tsx     terrarium entry     creature.tsx  creature-window entry
src-tauri/     Rust backend (minimal: store plugin, uptime, window setup) + config + capabilities
tests/         Vitest suites (engine, creature, long-run soak)
```

## Privacy

ECHOSEED reads **no** global keyboard input, **no** typed text, takes **no**
screenshots, and collects **no** browser history. The only signals used are
in-app interactions, the local clock, the current simulation state, and how long
the app has been open.

## Save integrity

Saves carry a schema `version`. On any corruption, version drift, or non-finite
data, loading falls back safely to a fresh world instead of crashing — see the
`corrupted save fallback` tests.

## Testing

```bash
pnpm test         # full suite (engine + creature + soak)
pnpm test:soak    # 20,000-tick headless soak run only
pnpm test:watch   # watch mode
```

Covered: deterministic seed, genome inheritance, mutation bounds, energy
consumption, feeding, reproduction, death, predator targeting, save/load round
trip, corrupted-save fallback, no-NaN invariants, creature needs bounds, and a
long-running soak test.

---

*ECHOSEED — plant a seed, watch it evolve, let it out.*
