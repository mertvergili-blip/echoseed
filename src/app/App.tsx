import { useEffect, useRef, useState, useCallback } from "react";
import { SimClient } from "./simClient";
import { TerrariumRenderer } from "../render/renderer";
import { storage } from "../platform/storage";
import {
  loadSave,
  randomSeed,
  DEFAULT_CREATURE,
  type UserSettings,
  type CreatureState,
} from "../sim/save";
import type { FrameData, RenderOrganism } from "../sim/protocol";
import type { HistorySample, LineageNode, Organism, Genome } from "../sim/types";
import { PopulationGraph, SpeciesRatioGraph } from "./components/Graphs";
import { Inspector } from "./components/Inspector";
import { openCreatureWindow, isTauriRuntime } from "../platform/creatureWindow";

interface LogEntry {
  tick: number;
  text: string;
}

declare global {
  interface Window {
    /** e2e-test-only surface — see the comment in the boot effect's onFrame. */
    __echoseedTestHook?: {
      organisms: RenderOrganism[];
      screenPointFromWorld: (wx: number, wy: number) => { x: number; y: number };
      isWater: (wx: number, wy: number) => boolean;
    };
  }
}

const SPEEDS = [1, 2, 4, 8, 16];

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<SimClient | null>(null);
  const rendererRef = useRef<TerrariumRenderer | null>(null);
  // Serializes PixiJS renderer init across the boot effect's invocations.
  // React 18 StrictMode mounts, cleans up, and re-mounts this effect
  // synchronously during dev, but `TerrariumRenderer.init()` is async and
  // acquires a WebGL context on the *same* <canvas> DOM node each time
  // (refs are stable across the double-invoke). Without this queue, the
  // StrictMode throwaway invocation's init() and the real invocation's
  // init() both start before either resolves, so two Pixi Applications
  // race to own one WebGL context — Pixi doesn't crash, but the second
  // context acquisition corrupts/loses the first, leaving the canvas
  // permanently blank ("Could not retrieve shader source (WebGL context
  // may be lost)" in the console, no visible error to the user). Chaining
  // each invocation's init behind the previous one's settled promise
  // means the throwaway invocation's init is skipped entirely (it sees
  // `disposed === true` before its turn comes up) instead of racing.
  const rendererTurnRef = useRef<Promise<void>>(Promise.resolve());

  const [frame, setFrame] = useState<FrameData | null>(null);
  const [history, setHistory] = useState<HistorySample[]>([]);
  const [lineage, setLineage] = useState<LineageNode[]>([]);
  const [selected, setSelected] = useState<Organism | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [following, setFollowing] = useState(false);

  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [seed, setSeed] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const [fps, setFps] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Mirrors `frame` state without being a useCallback dependency: handlers
  // that occasionally need "the current tick" (e.g. ascend(), for the event
  // log) read this ref instead of closing over `frame` directly, so those
  // handlers can have a stable identity across the ~30/sec frame updates
  // instead of being recreated every time (which would defeat memoizing the
  // child components — Inspector, the graphs — that receive them as props).
  const frameRef = useRef<FrameData | null>(null);
  const creatureRef = useRef<CreatureState>({ ...DEFAULT_CREATURE });
  const lastCountsRef = useRef({ plants: 0, herbivores: 0, predators: 0 });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const addLog = useCallback((tick: number, text: string) => {
    setLog((l) => [{ tick, text }, ...l].slice(0, 60));
  }, []);

  // ---- Boot: renderer + worker + load save --------------------------------
  useEffect(() => {
    let disposed = false;
    const client = new SimClient();
    clientRef.current = client;
    const renderer = new TerrariumRenderer();
    rendererRef.current = renderer;

    renderer.onFps = setFps;
    renderer.onPick = (id) => {
      setSelectedId(id);
      if (id != null) client.requestOrganism(id);
      else setSelected(null);
    };

    client.onFrame = (f) => {
      frameRef.current = f;
      setFrame(f);
      renderer.setFrame(f);
      // Test-only hook: organism sprites are canvas pixels, not DOM nodes,
      // so Playwright locators can't find "an organism" directly. Blindly
      // scanning click positions across the canvas (an earlier approach)
      // is slow and statistically flaky — it can burn most of a test's
      // timeout on bad luck alone. This exposes the live organism list plus
      // the same world->screen transform the renderer itself uses, so e2e
      // tests can click an exact, real organism instead of guessing.
      window.__echoseedTestHook = {
        organisms: f.organisms,
        screenPointFromWorld: (wx: number, wy: number) => renderer.screenPointFromWorld(wx, wy),
        isWater: (wx: number, wy: number) => renderer.isWaterAt(wx, wy),
      };
      // Detect population events for the log.
      const prev = lastCountsRef.current;
      if (f.counts.predators > prev.predators && f.tick > 5)
        addLog(f.tick, `predator born (pop ${f.counts.predators})`);
      if (f.counts.herbivores === 0 && prev.herbivores > 0)
        addLog(f.tick, `⚠ herbivores extinct`);
      if (f.counts.predators === 0 && prev.predators > 0)
        addLog(f.tick, `⚠ predators extinct`);
      lastCountsRef.current = f.counts;
    };
    client.onHistory = setHistory;
    client.onLineage = setLineage;
    client.onOrganism = (o) => setSelected(o);
    client.onReady = () => {
      if (!disposed) setReady(true);
    };

    const myTurn = rendererTurnRef.current.then(async () => {
      if (disposed || !canvasRef.current || !stageRef.current) return;
      await renderer.init(canvasRef.current, stageRef.current);
    });
    rendererTurnRef.current = myTurn.catch(() => {});

    (async () => {
      await myTurn;
      if (disposed) return; // unmounted while renderer.init() was in flight

      // Load persisted save or start fresh. `outcome.status` distinguishes a
      // genuine first launch ("empty") from a save that exists but could not
      // even be parsed ("corrupt") — the latter must never look like a fresh
      // start to the player without an explanation.
      const outcome = await storage.load();
      if (disposed) return; // unmounted while storage.load() was in flight
      if (outcome.status === "empty") {
        const s = randomSeed();
        setSeed(s);
        renderer.buildTerrain(s);
        client.init(s);
        addLog(0, `new world seeded: ${s}`);
      } else {
        const result = loadSave(outcome.status === "ok" ? outcome.data : null);
        setSeed(result.world.seed);
        renderer.buildTerrain(result.world.seed);
        setSpeed(result.settings.simSpeed);
        setPaused(result.settings.paused);
        setShowDebug(result.settings.showDebug);
        creatureRef.current = result.creature;
        client.loadSnapshot(result.world.snapshot());
        client.setSpeed(result.settings.simSpeed);
        client.pause(result.settings.paused);
        if (outcome.status === "corrupt") {
          showToast("Save file was unreadable — started a fresh world (your old save could not be recovered)");
          addLog(0, "save file corrupt: started fresh");
        } else if (result.recovered) {
          showToast(`Save recovered — started fresh (${result.reason ?? "corrupt"})`);
          addLog(0, `save recovered: ${result.reason}`);
        } else {
          addLog(result.world.tick, `world loaded @ tick ${result.world.tick}`);
        }
      }
    })();

    const onResize = () => renderer.resize();
    window.addEventListener("resize", onResize);

    // Background/foreground detection -> reduce update rate when hidden.
    const onVis = () => client.setBackground(document.hidden);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      client.destroy();
      renderer.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll selected organism details periodically for live meters.
  useEffect(() => {
    if (selectedId == null) return;
    const client = clientRef.current;
    if (!client) return;
    const t = setInterval(() => client.requestOrganism(selectedId), 500);
    return () => clearInterval(t);
  }, [selectedId]);

  // ---- Persistence: autosave ----------------------------------------------
  const doSave = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const snapshot = await client.requestSnapshot();
    const settings: UserSettings = { simSpeed: speed, paused, showDebug };
    // We reconstruct a lightweight save directly from the snapshot.
    const save = {
      version: snapshot.version,
      savedAt: Date.now(),
      world: snapshot,
      settings,
      creature: creatureRef.current,
    };
    await storage.save(save);
  }, [speed, paused, showDebug]);

  useEffect(() => {
    if (!ready) return;
    const t = setInterval(doSave, 15000);
    const onUnload = () => {
      // Best-effort — see the Tauri close-requested handler below for the
      // guaranteed path when running as the desktop app.
      void doSave();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      clearInterval(t);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [ready, doSave]);

  // Guaranteed save-before-close (Tauri only). doSave() round-trips a
  // snapshot request to the simulation Web Worker before writing to disk —
  // meaningfully more likely to still be in flight when the window closes
  // than a simple synchronous write, so beforeunload alone isn't reliable
  // here. Intercepting close-requested lets the save finish before the
  // window (and worker) actually tear down.
  useEffect(() => {
    if (!ready || !isTauriRuntime()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const off = await win.onCloseRequested(async (event) => {
          event.preventDefault();
          await doSave();
          await win.destroy();
        });
        if (cancelled) off();
        else unlisten = off;
      } catch {
        /* ignore — falls back to beforeunload's best-effort save */
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [ready, doSave]);

  // ---- Controls -----------------------------------------------------------
  const togglePause = () => {
    const p = !paused;
    setPaused(p);
    clientRef.current?.pause(p);
  };
  const changeSpeed = (s: number) => {
    setSpeed(s);
    clientRef.current?.setSpeed(s);
  };

  const intervene = useCallback(
    (
      type:
        | "addFood"
        | "rain"
        | "drought"
        | "cold"
        | "addHerbivore"
        | "addPredator"
        | "mutate"
        | "remove"
        | "setTemperature",
      opts: { x?: number; y?: number; value?: number; id?: number } = {},
    ) => {
      clientRef.current?.intervene({ type, ...opts });
      addLog(frameRef.current?.tick ?? 0, `intervention: ${type}`);
    },
    [addLog],
  );

  // Click-to-place food or pick organism.
  const onStageClick = (e: React.MouseEvent) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (e.shiftKey) {
      const wp = renderer.worldPointFromScreen(sx, sy);
      intervene("addFood", { x: wp.x, y: wp.y, value: 4 });
      return;
    }
    const id = renderer.pick(sx, sy);
    setSelectedId(id);
    if (id != null) clientRef.current?.requestOrganism(id);
    else setSelected(null);
  };

  // Wheel zoom + drag pan.
  const dragState = useRef<{ x: number; y: number } | null>(null);
  const onWheel = (e: React.WheelEvent) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    renderer.zoomBy(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - rect.left, e.clientY - rect.top);
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2 || e.button === 1) dragState.current = { x: e.clientX, y: e.clientY };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (dragState.current) {
      const dx = e.clientX - dragState.current.x;
      const dy = e.clientY - dragState.current.y;
      dragState.current = { x: e.clientX, y: e.clientY };
      rendererRef.current?.panBy(dx, dy);
    }
  };
  const onMouseUp = () => {
    dragState.current = null;
  };

  const doFollow = useCallback(
    (v: boolean) => {
      setFollowing(v);
      rendererRef.current?.setSelected(selectedId);
      rendererRef.current?.followSelected(v);
    },
    [selectedId],
  );

  const ascend = useCallback(
    (id: number) => {
      clientRef.current?.ascend(id);
      showToast(`Organism #${id} ascended to desktop creature`);
      addLog(frameRef.current?.tick ?? 0, `#${id} ascended`);
      void doSave();
    },
    [showToast, addLog, doSave],
  );

  const removeSelected = useCallback(
    (id: number) => {
      intervene("remove", { id });
      setSelected(null);
      setSelectedId(null);
    },
    [intervene],
  );

  const mutateSelected = useCallback((id: number) => intervene("mutate", { id }), [intervene]);

  const resetWorld = () => {
    const s = randomSeed();
    setSeed(s);
    setSelected(null);
    setSelectedId(null);
    setLog([]);
    setHistory([]);
    creatureRef.current = { ...DEFAULT_CREATURE };
    rendererRef.current?.buildTerrain(s);
    clientRef.current?.init(s);
    addLog(0, `reset with new seed: ${s}`);
    showToast(`New world: ${s}`);
  };

  const openCreature = async () => {
    await doSave();
    const opened = await openCreatureWindow();
    if (!opened) showToast("Desktop creature requires the Tauri app build");
  };

  // ---- Derived UI values --------------------------------------------------
  const env = frame?.env;
  const counts = frame?.counts ?? { plants: 0, herbivores: 0, predators: 0 };
  const total = counts.plants + counts.herbivores + counts.predators;
  const dominant = useDominantTraits(frame);

  const timeLabel = env ? formatTime(env.timeOfDay) : "--:--";
  const dayNum = frame ? Math.floor(frame.tick / (env?.dayLength ?? 2400)) + 1 : 1;

  return (
    <div className="app">
      {/* LEFT PANEL */}
      <div className="panel left">
        <div className="brand">
          <h1>
            <span className="seed-glyph" />
            ECHOSEED
          </h1>
          <div className="tagline">Artificial Ecosystem · Terrarium</div>
        </div>

        <div className="section">
          <div className="section-title">Simulation</div>
          <div className="row">
            <button className="btn primary" onClick={togglePause}>
              {paused ? "▶ Play" : "❚❚ Pause"}
            </button>
          </div>
          <div className="row speed-row" style={{ marginTop: 8 }}>
            {SPEEDS.map((s) => (
              <button
                key={s}
                className={`btn ${speed === s ? "active" : ""}`}
                onClick={() => changeSpeed(s)}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>

        <div className="section">
          <div className="section-title">Interventions</div>
          <div className="row">
            <button
              className="btn"
              title="Spawns a cluster of nutrient-rich plants near a random spot in the terrarium"
              onClick={() => intervene("addFood", { value: 6 })}
            >
              Add Food
            </button>
            <button
              className="btn"
              title="Spawns one new herbivore with a random genome at a random position"
              onClick={() => intervene("addHerbivore")}
            >
              + Herbivore
            </button>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="btn"
              title="Spawns one new predator with a random genome at a random position"
              onClick={() => intervene("addPredator")}
            >
              + Predator
            </button>
            <button
              className="btn"
              title="Raises moisture toward saturation for 600 ticks, boosting plant growth"
              onClick={() => intervene("rain", { value: 600 })}
            >
              Trigger Rain
            </button>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="btn"
              title="Lowers moisture and raises temperature for 600 ticks, stressing plant growth and food supply"
              onClick={() => intervene("drought", { value: 600 })}
            >
              Drought
            </button>
            <button
              className="btn"
              title="Sharply lowers temperature for 600 ticks, raising metabolic cost for organisms poorly adapted to cold"
              onClick={() => intervene("cold", { value: 600 })}
            >
              Cold Period
            </button>
          </div>
          <div className="section-title" style={{ marginTop: 12, marginBottom: 6 }}>
            Temperature
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            defaultValue={0.5}
            style={{ width: "100%" }}
            aria-label="World base temperature"
            title="Sets the terrarium's baseline temperature (cold ↔ hot)"
            onChange={(e) => intervene("setTemperature", { value: parseFloat(e.target.value) })}
          />
          <div className="stage-hint" style={{ position: "static", transform: "none", marginTop: 8, textAlign: "center" }}>
            shift-click terrarium to drop food
          </div>
        </div>

        <div className="section">
          <div className="section-title">World</div>
          <div className="seed-display">{seed}</div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={doSave}>
              Save
            </button>
            <button className="btn" onClick={resetWorld}>
              Reset ⟳
            </button>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn wide" onClick={openCreature}>
              {isTauriRuntime() ? "Open Desktop Creature" : "Desktop Creature (Tauri)"}
            </button>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className={`btn ${showDebug ? "active" : ""}`}
              onClick={() => setShowDebug((v) => !v)}
            >
              Debug {showDebug ? "On" : "Off"}
            </button>
          </div>
        </div>

        <div className="section">
          <div className="section-title">Dominant Traits</div>
          {dominant ? (
            <DominantTraits traits={dominant} />
          ) : (
            <div className="inspector-empty" style={{ padding: 10 }}>
              no mobile organisms
            </div>
          )}
        </div>
      </div>

      {/* STAGE */}
      <div
        className="stage"
        ref={stageRef}
        onClick={onStageClick}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas ref={canvasRef} />
        <div className="stage-overlay-top">
          <div className="hud-chip">
            <span className="label">Day</span>
            <span className="val">{dayNum}</span>
          </div>
          <div className="hud-chip">
            <span className="label">Time</span>
            <span className="val">{timeLabel}</span>
          </div>
          <div className="hud-chip">
            <span className="label">Tick</span>
            <span className="val">{frame?.tick ?? 0}</span>
          </div>
          <div className="hud-chip">
            <span className="label">Gen</span>
            <span className="val">{frame ? frame.avgGeneration.toFixed(1) : "0"}</span>
          </div>
          <div className="hud-chip">
            <span className="dot plant" />
            <span className="val">{counts.plants}</span>
            <span className="dot herb" style={{ marginLeft: 4 }} />
            <span className="val">{counts.herbivores}</span>
            <span className="dot pred" style={{ marginLeft: 4 }} />
            <span className="val">{counts.predators}</span>
          </div>
          {env && (
            <div className="hud-chip">
              <span className="label">Temp</span>
              <span className="val">{Math.round(env.temperature * 40)}°</span>
              <span className={`weather-badge ${env.weather}`} style={{ marginLeft: 6 }}>
                {env.weather}
              </span>
            </div>
          )}
        </div>

        <div className="stage-hint">
          click to select · scroll to zoom · right-drag to pan · shift-click to feed
        </div>

        {toast && <div className="toast">{toast}</div>}

        {showDebug && (
          <div className="debug-panel">
            render fps <span className="dv">{fps}</span>
            <br />
            sim tps <span className="dv">{frame?.tps ?? 0}</span>
            <br />
            organisms <span className="dv">{total}</span>
            <br />
            speed <span className="dv">{speed}×</span> {paused ? "(paused)" : ""}
          </div>
        )}
      </div>

      {/* RIGHT PANEL */}
      <div className="panel right">
        <Inspector
          organism={selected}
          lineage={lineage}
          onAscend={ascend}
          onRemove={removeSelected}
          onMutate={mutateSelected}
          onFollow={doFollow}
          following={following}
          ascendedId={frame?.ascendedId ?? null}
        />

        <div className="section">
          <div className="section-title">Population History</div>
          <PopulationGraph history={history} />
          <div className="graph-legend">
            <span>
              <span className="dot plant" /> plants
            </span>
            <span>
              <span className="dot herb" /> herbivores
            </span>
            <span>
              <span className="dot pred" /> predators
            </span>
          </div>
          <div className="section-title" style={{ marginTop: 12 }}>
            Species Ratio
          </div>
          <SpeciesRatioGraph history={history} />
        </div>

        <div className="section">
          <div className="section-title">Event Log</div>
          <div className="log">
            {log.length === 0 && <div className="log-line">no events yet…</div>}
            {log.map((l, i) => (
              <div className="log-line" key={i}>
                <span className="t">{l.tick}</span>
                {l.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DominantTraits({ traits }: { traits: Partial<Genome> }) {
  const picks: (keyof Genome)[] = ["aggression", "fear", "curiosity", "sociability", "movementSpeed"];
  return (
    <div>
      {picks.map((k) => {
        const v = traits[k];
        if (v == null) return null;
        const frac = k === "movementSpeed" ? Math.min(1, (v - 0.4) / 1.6) : v;
        return (
          <div className="genome-bar" key={k}>
            <div className="gb-head">
              <span className="name">{k.replace(/([A-Z])/g, " $1")}</span>
              <span className="gv">{v.toFixed(2)}</span>
            </div>
            <div className="track">
              <span style={{ width: `${frac * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function useDominantTraits(frame: FrameData | null): Partial<Genome> | null {
  // The worker computes true average genome across living mobile organisms
  // and ships it in each frame.
  return frame?.dominantTraits ?? null;
}

function formatTime(timeOfDay: number): string {
  const totalMin = Math.floor(timeOfDay * 24 * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
