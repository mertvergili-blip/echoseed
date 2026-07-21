import { memo, useEffect, useRef } from "react";
import type { Organism, LineageNode, Genome } from "../../sim/types";
import { GENOME_RANGES } from "../../sim/genome";
import { ACTION_NAMES } from "../../sim/protocol";

const SPECIES_COLOR: Record<string, string> = {
  plant: "#3ad29f",
  herbivore: "#53c0ff",
  predator: "#ff5c8a",
};

function hsl(hue: number, s = 70, l = 60) {
  return `hsl(${hue}, ${s}%, ${l}%)`;
}

/** Draws a small procedural portrait matching the renderer's style. */
function Portrait({ organism }: { organism: Organism }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const g = organism.genome;
    const cx = w / 2;
    const cy = h / 2;
    const radius = 14 + g.bodySize * 14;
    const color = hsl(g.visualHue);
    const dark = hsl(g.visualHue, 80, 35);

    // glow
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 2.4);
    grd.addColorStop(0, hsl(g.visualHue, 80, 55) + "");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (organism.species === "predator") {
      const spikes = 5 + Math.floor(g.bodyProportion * 3);
      ctx.beginPath();
      for (let i = 0; i <= spikes; i++) {
        const a = (i / spikes) * Math.PI * 2;
        const r = i % 2 === 0 ? radius * 1.5 : radius * 0.85;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.fillStyle = dark;
      ctx.fill();
    } else if (organism.species === "herbivore") {
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius * 1.2, radius, 0, 0, Math.PI * 2);
      ctx.fillStyle = dark;
      ctx.fill();
    } else {
      const blades = 5 + Math.floor(g.bodyProportion * 3);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      for (let i = 0; i < blades; i++) {
        const a = (i / blades) * Math.PI * 2;
        const len = radius * (1.2 + g.bodyProportion);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * len * 0.4, cy + Math.sin(a) * len);
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }, [organism]);

  return <canvas ref={ref} className="creature-portrait" />;
}

function GenomeBar({ name, value, min, max }: { name: string; value: number; min: number; max: number }) {
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const label = name.replace(/([A-Z])/g, " $1").toLowerCase();
  return (
    <div className="genome-bar">
      <div className="gb-head">
        <span className="name">{label}</span>
        <span className="gv">{value.toFixed(name === "visualHue" || name === "visionRadius" ? 0 : 2)}</span>
      </div>
      <div className="track">
        <span style={{ width: `${frac * 100}%` }} />
      </div>
    </div>
  );
}

// Wrapped in memo(): the parent's `frame` state updates ~30/sec, but this
// component's actual props (selected organism, lineage, ascendedId) change
// far less often. Without memo, every frame tick would re-run this
// component's full render body (genome bars, lineage list, portrait canvas
// effect) for no visible difference in output. App.tsx keeps the callback
// props (onAscend/onRemove/onMutate/onFollow) stable via useCallback so they
// don't defeat this by looking "changed" on every render.
export const Inspector = memo(function Inspector({
  organism,
  lineage,
  onAscend,
  onRemove,
  onMutate,
  onFollow,
  following,
  ascendedId,
}: {
  organism: Organism | null;
  lineage: LineageNode[];
  onAscend: (id: number) => void;
  onRemove: (id: number) => void;
  onMutate: (id: number) => void;
  onFollow: (v: boolean) => void;
  following: boolean;
  ascendedId: number | null;
}) {
  if (!organism) {
    return (
      <div className="section">
        <div className="section-title">Inspector</div>
        <div className="inspector-empty">
          Click an organism in the terrarium to inspect its genome, lineage, and behaviour.
        </div>
      </div>
    );
  }

  const g = organism.genome;
  const geneKeys = Object.keys(GENOME_RANGES) as (keyof Genome)[];
  const parents = organism.parentIds;
  const node = lineage.find((n) => n.id === organism.id);
  const children = lineage.filter(
    (n) => n.parentIds && (n.parentIds[0] === organism.id || n.parentIds[1] === organism.id),
  );
  const isAscended = ascendedId === organism.id;

  return (
    <div className="section">
      <div className="section-title">
        Inspector
        <button className="mini-btn" onClick={() => onFollow(!following)}>
          {following ? "● following" : "◎ follow"}
        </button>
      </div>

      <Portrait organism={organism} />

      <div className="id-line">
        <span
          className="species-tag"
          style={{
            color: SPECIES_COLOR[organism.species],
            background: `${SPECIES_COLOR[organism.species]}1a`,
          }}
        >
          {organism.species}
        </span>
        <span className="oid">#{organism.id}</span>
      </div>

      {isAscended && (
        <div className="ascend-badge">
          <div className="title">Ascended Creature</div>
          This organism inhabits the desktop companion window.
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 10 }}>
        <div className="stat">
          <div className="k">Generation</div>
          <div className="v small">{organism.generation}</div>
        </div>
        <div className="stat">
          <div className="k">Age</div>
          <div className="v small">{organism.age}</div>
        </div>
        <div className="stat">
          <div className="k">Health</div>
          <div className="v small">{Math.round((organism.health / organism.maxHealth) * 100)}%</div>
        </div>
        <div className="stat">
          <div className="k">Energy</div>
          <div className="v small">{Math.round((organism.energy / organism.maxEnergy) * 100)}%</div>
        </div>
      </div>

      <div className="env-line">
        <span className="lbl">Action</span>
        <span className="num">{ACTION_NAMES[actionIdx(organism)] ?? organism.action}</span>
      </div>

      <div className="section-title" style={{ marginTop: 12 }}>
        Genome
      </div>
      {geneKeys.map((k) => (
        <GenomeBar
          key={k}
          name={k}
          value={g[k] as number}
          min={GENOME_RANGES[k][0]}
          max={GENOME_RANGES[k][1]}
        />
      ))}

      <div className="section-title" style={{ marginTop: 12 }}>
        Lineage
      </div>
      <div className="lineage-item">
        <span>parents</span>
        <span>{parents ? `#${parents[0]} × #${parents[1]}` : "— origin —"}</span>
      </div>
      <div className="lineage-item">
        <span>offspring</span>
        <span>{node?.offspring ?? organism.offspringCount}</span>
      </div>
      {children.slice(0, 6).map((c) => (
        <div className="lineage-item" key={c.id}>
          <span>child #{c.id}</span>
          <span>
            gen {c.generation} {c.diedTick == null ? "· alive" : "· †"}
          </span>
        </div>
      ))}

      <div className="row" style={{ marginTop: 12 }}>
        {organism.species !== "plant" && (
          <button className="btn primary" onClick={() => onAscend(organism.id)}>
            {isAscended ? "Re-ascend" : "Ascend"}
          </button>
        )}
        <button className="btn" onClick={() => onMutate(organism.id)}>
          Mutate
        </button>
        <button className="btn danger" onClick={() => onRemove(organism.id)}>
          Remove
        </button>
      </div>
    </div>
  );
});

function actionIdx(o: Organism): number {
  return ACTION_NAMES.indexOf(o.action);
}
