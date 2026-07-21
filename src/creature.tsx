import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { storage } from "./platform/storage";
import { loadSave, makeSave, randomSeed, DEFAULT_CREATURE, type CreatureState } from "./sim/save";
import { randomGenome } from "./sim/genome";
import { Rng } from "./sim/rng";
import { CreatureEngine } from "./creature/creatureEngine";
import { CreatureRenderer } from "./creature/creatureRender";
import { clampToMonitor, clampMenuPosition, offlineCatchupSeconds } from "./creature/windowMath";
import type { Genome } from "./sim/types";
import { isTauriRuntime } from "./platform/creatureWindow";
import { ErrorBoundary } from "./app/ErrorBoundary";
import "./styles.css";

function resolveAscended(): { genome: Genome; state: CreatureState } {
  // Loaded synchronously-ish via the async wrapper in the component.
  return { genome: randomGenome(new Rng(randomSeed()), "herbivore"), state: { ...DEFAULT_CREATURE } };
}

interface StatsSnapshot {
  hunger: number;
  energy: number;
  trust: number;
  curiosity: number;
  mood: string;
  moodValue: number;
  activity: string;
  activeAnimation: string | null;
  lastInteractionTick: number;
}

function snapshotStats(engine: CreatureEngine): StatsSnapshot {
  return {
    hunger: engine.state.hunger,
    energy: engine.state.energy,
    trust: engine.state.trust,
    curiosity: engine.state.curiosity,
    mood: engine.mood,
    moodValue: engine.state.mood,
    activity: engine.activity,
    activeAnimation: engine.activeAnimation,
    lastInteractionTick: engine.state.lastInteractionTick,
  };
}

function CreatureApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<CreatureEngine | null>(null);
  const rendererRef = useRef<CreatureRenderer | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState("");
  const [statsSnapshot, setStatsSnapshot] = useState<StatsSnapshot | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // While true, the click-through hit-test loop is suppressed so the window
  // never starts ignoring cursor events mid-drag or while the context menu
  // (a real interactive overlay) is open.
  const suppressPassthrough = useRef(false);
  // Cursor position in window-local [0,1] space, or null when the cursor
  // isn't over this window — the only signal the creature engine reacts to
  // (see the pointermove handler below). Read once per animation frame
  // rather than driving React state, since it changes far too often for that.
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returningRef = useRef(false);

  // Boot: load save, resolve ascended genome, catch up on offline time, start loop.
  useEffect(() => {
    let raf = 0;
    let disposed = false;

    (async () => {
      const outcome = await storage.load();
      let genome: Genome;
      let cstate: CreatureState;
      let offlineSeconds = 0;
      if (outcome.status !== "empty") {
        // loadSave safely falls back to a fresh world on "corrupt" data too
        // (same guarantee the terrarium window relies on) — the corrupt case
        // is surfaced to the player from the terrarium window's toast, since
        // this standalone creature window has no UI for it.
        const res = loadSave(outcome.status === "ok" ? outcome.data : null);
        cstate = res.creature;
        const w = res.world;
        const asc = w.ascendedId != null ? w.getById(w.ascendedId) : null;
        const chosen =
          asc ??
          w.organisms.find((o) => o.alive && o.species !== "plant") ??
          null;
        genome = chosen ? chosen.genome : resolveAscended().genome;
        if (res.savedAt != null) {
          offlineSeconds = offlineCatchupSeconds(res.savedAt, Date.now());
        }
      } else {
        const fallback = resolveAscended();
        genome = fallback.genome;
        cstate = fallback.state;
      }

      if (disposed) return;
      const engine = new CreatureEngine(genome, cstate);
      engineRef.current = engine;
      if (offlineSeconds > 0) {
        // Catch the creature's needs up on real time elapsed while its
        // window was closed, in one step, rather than leaving hunger/energy
        // exactly as they were the instant the app last saved — a creature
        // closed for hours should visibly be hungrier when you reopen it.
        engine.update(offlineSeconds);
      }
      if (canvasRef.current) {
        rendererRef.current = new CreatureRenderer(canvasRef.current);
      }
      setLoaded(true);

      let last = performance.now();
      let statsThrottle = 0;
      const loop = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const cursor = cursorRef.current;
        engine.update(dt, cursor);
        rendererRef.current?.setLookTarget(engine, cursor);
        rendererRef.current?.draw(engine, dt);
        setStatus(
          `${engine.mood} · ${engine.activity} · hun ${(engine.state.hunger * 100) | 0}% en ${(engine.state.energy * 100) | 0}%`,
        );
        // Needs-panel/debug-panel state changes far less than every frame
        // needs to be reflected on screen; throttle the React state update
        // that drives them instead of doing it 60x/sec.
        statsThrottle += dt;
        if (statsThrottle > 0.15) {
          statsThrottle = 0;
          setStatsSnapshot(snapshotStats(engine));
        }
        if (engine.isReturning && engine.returnProgress >= 1 && !returningRef.current) {
          returningRef.current = true;
          void persistAndReturn(engine.state);
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();

    const onResize = () => rendererRef.current?.resize();
    window.addEventListener("resize", onResize);

    // Track the cursor while it's over this window, in canvas-local [0,1]
    // space, so the engine can notice/follow/flee from it. This is the
    // window's own pointer events only — no global mouse hook, and (per the
    // click-through system below) events don't even fire here while the
    // cursor is over a transparent part of the window.
    const onPointerMove = (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      cursorRef.current = {
        x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
      };
    };
    const onPointerLeave = () => {
      cursorRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerout", onPointerLeave);

    // Persist creature state periodically & on unload. beforeunload is
    // best-effort (see the Tauri close-requested handler below for the
    // guaranteed path); it still helps for the browser fallback build,
    // where there is no close-requested equivalent.
    const saveState = async () => {
      const engine = engineRef.current;
      if (!engine) return;
      await mergeCreatureState(engine.state);
    };
    const saveTimer = setInterval(saveState, 8000);
    const onUnload = () => void saveState();
    window.addEventListener("beforeunload", onUnload);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerout", onPointerLeave);
      window.removeEventListener("beforeunload", onUnload);
      clearInterval(saveTimer);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // Guaranteed save-before-close (Tauri only): beforeunload is best-effort
  // and can't reliably await async Tauri Store I/O before the native window
  // actually tears down. Intercepting close-requested lets us finish the
  // save first, then close explicitly.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const off = await win.onCloseRequested(async (event) => {
          event.preventDefault();
          const engine = engineRef.current;
          if (engine) await mergeCreatureState(engine.state);
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
  }, []);

  // Autonomous window drift across the screen (Tauri only).
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout>;

    const drift = async () => {
      if (cancelled) return;
      const engine = engineRef.current;
      try {
        if (engine && (engine.activity === "wander" || engine.activity === "play")) {
          const { getCurrentWindow, LogicalPosition, currentMonitor } = await import(
            "@tauri-apps/api/window"
          );
          const win = getCurrentWindow();
          const mon = await currentMonitor();
          const pos = await win.outerPosition();
          const size = await win.outerSize();
          const scale = mon?.scaleFactor ?? 1;
          const ww = size.width / scale;
          const wh = size.height / scale;
          const curX = pos.x / scale;
          const curY = pos.y / scale;
          const desired = {
            x: curX + (Math.random() - 0.5) * 260,
            y: curY + (Math.random() - 0.5) * 180,
          };
          // Monitor bounds are in *global* virtual-desktop coordinates, not
          // relative to the monitor itself — clampToMonitor accounts for
          // monitor.position so this stays correct on multi-monitor setups
          // where the current monitor isn't the one at the global origin.
          const monitorBounds = mon
            ? {
                x: mon.position.x / scale,
                y: mon.position.y / scale,
                w: mon.size.width / scale,
                h: mon.size.height / scale,
              }
            : { x: 0, y: 0, w: 1920, h: 1080 };
          const clamped = clampToMonitor(monitorBounds, { w: ww, h: wh }, desired);
          await win.setPosition(new LogicalPosition(clamped.x, clamped.y));
        }
      } catch {
        /* ignore movement errors */
      }
      handle = setTimeout(drift, 4000 + Math.random() * 4000);
    };
    handle = setTimeout(drift, 5000);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, []);

  // Click-through for transparent areas (Tauri only): poll the global cursor
  // position (a real OS-level query, unaffected by whether this window is
  // currently receiving pointer events) and sample the rendered canvas's
  // alpha channel underneath it. Empty/transparent space toggles
  // setIgnoreCursorEvents(true) so a click there passes through to whatever
  // is behind the window instead of the window swallowing it; opaque
  // (creature body) pixels keep the window interactive.
  //
  // Honest limitation: this is polling-based (checked a few times a second),
  // not true OS-level per-pixel hit-testing, so there is a small window
  // (well under the polling interval) where a very fast mouse movement could
  // see a one-frame-stale passthrough state. It also only runs while the
  // window isn't being dragged or showing the context menu, both of which
  // force cursor events back on so those interactions are never swallowed.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let lastIgnoring: boolean | null = null;
    const POLL_MS = 90;

    const tick = async () => {
      if (cancelled) return;
      try {
        if (!suppressPassthrough.current) {
          const { getCurrentWindow, cursorPosition } = await import("@tauri-apps/api/window");
          const win = getCurrentWindow();
          const [cursor, winPos, scale] = await Promise.all([
            cursorPosition(),
            win.outerPosition(),
            win.scaleFactor(),
          ]);
          const localX = (cursor.x - winPos.x) / scale;
          const localY = (cursor.y - winPos.y) / scale;
          const canvas = canvasRef.current;
          let shouldIgnore = true;
          if (canvas && localX >= 0 && localY >= 0 && localX < canvas.clientWidth && localY < canvas.clientHeight) {
            const ctx = canvas.getContext("2d");
            if (ctx) {
              const dpr = window.devicePixelRatio || 1;
              const px = Math.min(canvas.width - 1, Math.max(0, Math.round(localX * dpr)));
              const py = Math.min(canvas.height - 1, Math.max(0, Math.round(localY * dpr)));
              const alpha = ctx.getImageData(px, py, 1, 1).data[3];
              shouldIgnore = alpha < 12; // near-fully-transparent pixel
            } else {
              shouldIgnore = false; // can't sample — safer to stay interactive
            }
          }
          if (shouldIgnore !== lastIgnoring) {
            lastIgnoring = shouldIgnore;
            await win.setIgnoreCursorEvents(shouldIgnore);
          }
        } else if (lastIgnoring !== false) {
          // Dragging or menu open: force interactive regardless of pixel state.
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          lastIgnoring = false;
          await getCurrentWindow().setIgnoreCursorEvents(false);
        }
      } catch {
        /* ignore — worst case the window stays fully interactive */
      }
      setTimeout(tick, POLL_MS);
    };
    const handle = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, []);

  // Dragging: in Tauri, drag the OS window; in browser, move creature in-canvas.
  const onPointerDown = async (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setMenu(null);
    if (isTauriRuntime()) {
      try {
        suppressPassthrough.current = true;
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().startDragging();
      } catch {
        /* ignore */
      } finally {
        suppressPassthrough.current = false;
      }
    } else {
      // Browser: move creature toward pointer while held.
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        engine.y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
        engine.state.trust = Math.min(1, engine.state.trust + 0.001);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    suppressPassthrough.current = true;
    // Clamp so the menu never extends past the (small) window's edge, where
    // `overflow: hidden` would otherwise clip it and make items unreachable.
    const clamped = clampMenuPosition(
      { x: e.clientX, y: e.clientY },
      { w: 168, h: 260 },
      { w: window.innerWidth, h: window.innerHeight },
    );
    setMenu(clamped);
  };

  const closeMenu = () => {
    setMenu(null);
    suppressPassthrough.current = false;
  };

  const showToast = (text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };

  const burstAt = (kind: "feed" | "pet" | "wake") => {
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!engine || !canvas || !renderer) return;
    const r = 18 + engine.genome.bodySize * 16;
    renderer.burst(kind, engine.x * canvas.clientWidth, engine.y * canvas.clientHeight, r);
  };

  const act = async (action: string) => {
    const engine = engineRef.current;
    closeMenu();
    if (!engine) return;
    switch (action) {
      case "feed": {
        const hungerDelta = engine.feed();
        burstAt("feed");
        showToast(`Fed — hunger ${hungerDelta > 0 ? "−" : ""}${Math.round(hungerDelta * 100)}%`);
        break;
      }
      case "pet": {
        const trustBefore = engine.state.trust;
        engine.pet();
        burstAt("pet");
        showToast(`Petted — trust +${Math.round((engine.state.trust - trustBefore) * 100)}%`);
        break;
      }
      case "sleep":
        engine.sleep();
        showToast("Settling in to sleep…");
        break;
      case "return":
        // Play the dissolve animation first; the render loop calls
        // persistAndReturn() once engine.returnProgress reaches 1, so the
        // window doesn't just vanish mid-frame.
        engine.beginReturn();
        break;
      case "open":
        await openTerrarium();
        break;
    }
  };

  return (
    <div
      className="creature-stage"
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      style={{ cursor: "grab" }}
    >
      <canvas ref={canvasRef} />
      <div className="creature-status">{loaded ? status : "waking…"}</div>
      {toast && <div className="creature-toast">{toast}</div>}
      {import.meta.env.DEV && statsSnapshot && <DebugPanel stats={statsSnapshot} />}
      {menu && (
        // stopPropagation on pointerdown: without it, pressing a menu button
        // bubbles up to the stage's onPointerDown and calls startDragging(),
        // which (on at least Windows/WebView2) can swallow the click the OS
        // drag operation was started from, so the button's onClick never
        // fires. The menu is only ever opened by an explicit right-click, so
        // there's no legitimate case where a press inside it should also
        // start dragging the window.
        <div
          className="creature-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {statsSnapshot && <StatsCard stats={statsSnapshot} />}
          <button onClick={() => act("feed")}>🍃 Feed</button>
          <button onClick={() => act("pet")}>✧ Pet</button>
          <button onClick={() => act("sleep")}>☾ Sleep</button>
          <button onClick={() => act("return")}>⟵ Return to Terrarium</button>
          <button onClick={() => act("open")}>◱ Open Terrarium</button>
        </div>
      )}
    </div>
  );
}

/** Compact, elegant stat card shown inside the right-click menu (the
 * creature window is only 220×220px — too small for a separate floating
 * panel without it overlapping/overflowing the menu itself). */
function StatsCard({ stats }: { stats: StatsSnapshot }) {
  const bars: [string, number][] = [
    ["Hunger", stats.hunger],
    ["Energy", stats.energy],
    ["Trust", stats.trust],
    ["Curiosity", stats.curiosity],
    ["Mood", stats.moodValue],
  ];
  return (
    <div className="creature-stats-card">
      {bars.map(([label, v]) => (
        <div className="creature-stat-row" key={label}>
          <span className="csr-label">{label}</span>
          <span className="csr-track">
            <span className="csr-fill" style={{ width: `${Math.round(v * 100)}%` }} />
          </span>
        </div>
      ))}
      <div className="creature-stat-action">
        {stats.mood} · {stats.activity}
      </div>
    </div>
  );
}

/** Development-only overlay with raw engine state, for debugging mood/
 * animation transitions without needing to open devtools. */
function DebugPanel({ stats }: { stats: StatsSnapshot }) {
  const lastAgo = stats.lastInteractionTick ? Math.round((Date.now() - stats.lastInteractionTick) / 1000) : null;
  return (
    <div className="debug-panel creature-debug-panel">
      <div>
        mood <span className="dv">{stats.mood}</span>
      </div>
      <div>
        action <span className="dv">{stats.activity}</span>
      </div>
      <div>
        anim <span className="dv">{stats.activeAnimation ?? "none"}</span>
      </div>
      <div>
        hunger <span className="dv">{stats.hunger.toFixed(2)}</span> energy{" "}
        <span className="dv">{stats.energy.toFixed(2)}</span>
      </div>
      <div>
        trust <span className="dv">{stats.trust.toFixed(2)}</span>
      </div>
      <div>
        last interaction{" "}
        <span className="dv">{lastAgo == null ? "never" : `${lastAgo}s ago`}</span>
      </div>
    </div>
  );
}

/**
 * Merge an updated creature state into the existing save without disturbing
 * the rest of it. Always routes through loadSave()/makeSave() rather than
 * blindly mutating whatever was on disk — that would "launder" a corrupt or
 * malformed save back into looking legitimate while leaving its world data
 * untouched and unvalidated. If the existing save is corrupt, this
 * self-heals it into a valid save (fresh world + the creature's current
 * state) instead of leaving an unreadable file that fails every future load.
 */
async function mergeCreatureState(state: CreatureState): Promise<void> {
  const outcome = await storage.load();
  if (outcome.status === "empty") return; // nothing to merge into yet
  const result = loadSave(outcome.status === "ok" ? outcome.data : null);
  const save = makeSave(result.world, result.settings, state);
  await storage.save(save);
}

async function persistAndReturn(state: CreatureState) {
  await mergeCreatureState(state);
  if (isTauriRuntime()) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      /* ignore */
    }
  } else {
    window.close();
  }
}

async function openTerrarium() {
  if (isTauriRuntime()) {
    try {
      const { WebviewWindow, getAllWebviewWindows } = await import(
        "@tauri-apps/api/webviewWindow"
      );
      const all = await getAllWebviewWindows();
      const main = all.find((w) => w.label === "main");
      if (main) {
        await main.show();
        await main.setFocus();
        return;
      }
      new WebviewWindow("main", { url: "index.html", title: "ECHOSEED", width: 1280, height: 820 });
    } catch {
      /* ignore */
    }
  } else {
    window.open("index.html", "echoseed-terrarium");
  }
}

const root = document.getElementById("creature-root")!;
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary label="Desktop Creature">
      <CreatureApp />
    </ErrorBoundary>
  </StrictMode>,
);
