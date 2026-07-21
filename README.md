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

A GitHub Actions workflow (`.github/workflows/windows-build.yml`) builds this
on a real `windows-latest` runner on every push/PR touching the app or `src-tauri/`,
and can also be triggered manually. It has been run end-to-end at least once
and produced a working `.msi`, NSIS `.exe`, and standalone `echoseed.exe` as
downloadable workflow artifacts — this isn't just a theoretical config, it has
verifiably built a Windows installer from this repository.

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
  app/         React terrarium UI (App, ErrorBoundary, SimClient, components)
  creature/    desktop-creature engine, canvas renderer, window/monitor math (windowMath.ts)
  platform/    storage adapter (Tauri Store ↔ localStorage) + creature window
  main.tsx     terrarium entry     creature.tsx  creature-window entry
src-tauri/     Rust backend (store plugin, uptime, window setup, unit tests) + config + capabilities
scripts/       analyze.ts — permanent multi-seed simulation analysis tool
tests/         Vitest suites (engine, genome behavior, natural selection, save/load,
               storage, window math, creature, long-run soak)
tests/e2e/     Playwright suite against the real running app (terrarium, desktop
               creature window, accessibility)
.github/workflows/  windows-build.yml — Windows CI build/bundle
```

## Privacy

ECHOSEED reads **no** global keyboard input, **no** typed text, takes **no**
screenshots, and collects **no** browser history. The only signals used are
in-app interactions, the local clock, the current simulation state, and how long
the app has been open.

## Accessibility & robustness

- Keyboard focus is visible on every interactive control (`:focus-visible`
  outline), and `prefers-reduced-motion` dampens the terrarium's decorative
  glow-pulse/sway/shimmer animation to near-zero amplitude.
- A React error boundary wraps both the terrarium and creature windows: an
  unexpected render crash shows a dark-themed fallback with a reload button
  instead of a blank white screen.
- Corrupted, truncated, or schema-invalid saves are detected explicitly (not
  conflated with "no save yet") and repaired field-by-field where possible,
  with a toast telling the player what happened — see "Save integrity" below.

## Save integrity

Saves carry a schema `version`. On any corruption, version drift, or non-finite
data, loading falls back safely to a fresh world instead of crashing — see the
`corrupted save fallback` tests.

## Testing

```bash
pnpm test         # full Vitest suite (engine, genome behavior, natural selection,
                   # save/load, storage, window math, creature, soak)
pnpm test:soak    # 20,000-tick headless soak run only
pnpm test:watch   # watch mode
pnpm test:e2e     # Playwright suite against the real running app
pnpm typecheck    # tsc --noEmit
pnpm lint         # ESLint, zero warnings allowed
pnpm analyze      # headless multi-seed simulation analysis (pnpm analyze [seeds] [ticks])
```

**Vitest** (unit/integration, runs the simulation directly, no browser) covers:
deterministic replay — including a byte-identical full-state check at multiple
tick checkpoints, not just aggregate stats — genome inheritance, mutation
bounds, per-trait behavioral effects (fear/aggression/curiosity/sociability
measurably change what an organism does), controlled natural-selection
experiments (predation, cold, heat, drought/scarcity, predator-free) proving
advantageous traits actually win head-to-head survival contests rather than
just "look different," population-balance stability across many seeds,
save/load round-tripping including partial corruption repair, the
empty/corrupt/ok storage-layer distinction, creature needs bounds, desktop
creature window/monitor math, and a long-running soak test.

**Playwright** (`tests/e2e/`, real browser against the running app) covers:
boot into a live simulation, pause/resume, all speed multipliers, every
weather/temperature intervention, add-food/herbivore/predator, organism
selection and the inspector's genome display, ascend, camera follow, save,
reset, corrupted/invalid-save recovery, the desktop creature popup window and
its context menu actions, keyboard focus visibility, and `prefers-reduced-motion`.
Every test fails on any console error, unhandled page error, or failed network
request — not just on the specific assertion it's checking — via a shared
`trackedPage` fixture (see `tests/e2e/helpers.ts`).

---

*ECHOSEED — plant a seed, watch it evolve, let it out.*
