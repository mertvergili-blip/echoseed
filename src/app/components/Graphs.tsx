import { memo, useEffect, useRef } from "react";
import type { HistorySample } from "../../sim/types";

/**
 * Stacked population history line graph, drawn on a canvas. Wrapped in
 * memo(): `history` only updates on init/load/intervention (see the sim
 * worker), much less often than the parent's ~30/sec `frame` state, so
 * without memo this canvas effect's surrounding component body would
 * needlessly re-run on every frame tick even though nothing it depends on
 * changed.
 */
export const PopulationGraph = memo(function PopulationGraph({
  history,
}: {
  history: HistorySample[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (history.length < 2) {
      ctx.fillStyle = "#4b566b";
      ctx.font = "10px monospace";
      ctx.fillText("collecting data…", 8, h / 2);
      return;
    }

    let maxTotal = 1;
    for (const s of history) {
      maxTotal = Math.max(maxTotal, s.plants + s.herbivores + s.predators);
    }

    const n = history.length;
    const xAt = (i: number) => (i / (n - 1)) * w;
    const yAt = (v: number) => h - (v / maxTotal) * (h - 6) - 3;

    const series: { key: keyof HistorySample; color: string }[] = [
      { key: "plants", color: "#3ad29f" },
      { key: "herbivores", color: "#53c0ff" },
      { key: "predators", color: "#ff5c8a" },
    ];

    for (const { key, color } of series) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = history[i][key] as number;
        const x = xAt(i);
        const y = yAt(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }, [history]);

  return <canvas ref={ref} className="graph" />;
});

/** Species ratio stacked-bar over time. Memoized for the same reason as
 * PopulationGraph above. */
export const SpeciesRatioGraph = memo(function SpeciesRatioGraph({
  history,
}: {
  history: HistorySample[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (history.length < 2) return;
    const n = history.length;
    const colW = w / n;
    for (let i = 0; i < n; i++) {
      const s = history[i];
      const total = s.plants + s.herbivores + s.predators || 1;
      const x = i * colW;
      let y = 0;
      const segs: [number, string][] = [
        [s.plants / total, "#3ad29f"],
        [s.herbivores / total, "#53c0ff"],
        [s.predators / total, "#ff5c8a"],
      ];
      for (const [frac, color] of segs) {
        const segH = frac * h;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, y, colW + 0.5, segH);
        y += segH;
      }
    }
    ctx.globalAlpha = 1;
  }, [history]);

  return <canvas ref={ref} className="graph" style={{ height: 46 }} />;
});
