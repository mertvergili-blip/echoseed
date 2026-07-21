import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { storage } from "./platform/storage";
import { loadSave, makeSave, randomSeed, DEFAULT_CREATURE, type CreatureState } from "./sim/save";
import { randomGenome } from "./sim/genome";
import { Rng } from "./sim/rng";
import { CreatureEngine } from "./creature/creatureEngine";
import { CreatureRenderer } from "./creature/creatureRender";
import type { Genome } from "./sim/types";
import { isTauriRuntime } from "./platform/creatureWindow";
import "./styles.css";

function resolveAscended(): { genome: Genome; state: CreatureState } {
  // Loaded synchronously-ish via the async wrapper in the component.
  return { genome: randomGenome(new Rng(randomSeed()), "herbivore"), state: { ...DEFAULT_CREATURE } };
}

function CreatureApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<CreatureEngine | null>(null);
  const rendererRef = useRef<CreatureRenderer | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);
  const draggingWindow = useRef(false);

  // Boot: load save, resolve ascended genome, start loop.
  useEffect(() => {
    let raf = 0;
    let disposed = false;

    (async () => {
      const outcome = await storage.load();
      let genome: Genome;
      let cstate: CreatureState;
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
      } else {
        const fallback = resolveAscended();
        genome = fallback.genome;
        cstate = fallback.state;
      }

      if (disposed) return;
      const engine = new CreatureEngine(genome, cstate);
      engineRef.current = engine;
      if (canvasRef.current) {
        rendererRef.current = new CreatureRenderer(canvasRef.current);
      }
      setLoaded(true);

      let last = performance.now();
      const loop = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        engine.update(dt);
        rendererRef.current?.draw(engine, dt);
        setStatus(
          `${engine.mood} · ${engine.activity} · hun ${(engine.state.hunger * 100) | 0}% en ${(engine.state.energy * 100) | 0}%`,
        );
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    })();

    const onResize = () => rendererRef.current?.resize();
    window.addEventListener("resize", onResize);

    // Persist creature state periodically & on unload.
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
      window.removeEventListener("beforeunload", onUnload);
      clearInterval(saveTimer);
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
          const { getCurrentWindow, LogicalPosition } = await import("@tauri-apps/api/window");
          const { currentMonitor } = await import("@tauri-apps/api/window");
          const win = getCurrentWindow();
          const mon = await currentMonitor();
          const pos = await win.outerPosition();
          const size = await win.outerSize();
          const scale = mon?.scaleFactor ?? 1;
          const sw = (mon?.size.width ?? 1920) / scale;
          const sh = (mon?.size.height ?? 1080) / scale;
          const ww = size.width / scale;
          const wh = size.height / scale;
          const curX = pos.x / scale;
          const curY = pos.y / scale;
          // Nudge toward a random nearby point, staying on-screen.
          const nx = Math.max(0, Math.min(sw - ww, curX + (Math.random() - 0.5) * 260));
          const ny = Math.max(0, Math.min(sh - wh, curY + (Math.random() - 0.5) * 180));
          await win.setPosition(new LogicalPosition(nx, ny));
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

  // Dragging: in Tauri, drag the OS window; in browser, move creature in-canvas.
  const onPointerDown = async (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setMenu(null);
    if (isTauriRuntime()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        draggingWindow.current = true;
        await getCurrentWindow().startDragging();
      } catch {
        /* ignore */
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
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const act = async (action: string) => {
    const engine = engineRef.current;
    setMenu(null);
    if (!engine) return;
    switch (action) {
      case "feed":
        engine.feed();
        break;
      case "pet":
        engine.pet();
        break;
      case "sleep":
        engine.sleep();
        break;
      case "return":
        // Persist and close creature window / return to terrarium.
        await persistAndReturn(engine.state);
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
      {menu && (
        <div className="creature-menu" style={{ left: menu.x, top: menu.y }}>
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
    <CreatureApp />
  </StrictMode>,
);
