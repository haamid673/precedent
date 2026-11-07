"use client";
import { useEffect, useRef, useState } from "react";
import type { ArmSummary, PerPr } from "@/lib/results";

type Metric = "volume" | "precision" | "recovered";

const METRICS: { id: Metric; label: string; title: string; pct: boolean }[] = [
  { id: "volume", label: "Comments per PR", title: "Comments per PR", pct: false },
  { id: "precision", label: "Matches a maintainer", title: "Share of comments that match a maintainer", pct: true },
  { id: "recovered", label: "Maintainer comments recovered", title: "Share of real maintainer comments recovered", pct: true },
];

/** Value of a metric over a trailing window of PRs ending at index i. */
function windowed(series: (PerPr | null)[], i: number, win: number, m: Metric): number | null {
  const rows = series.slice(Math.max(0, i - win + 1), i + 1).filter((r): r is PerPr => !!r);
  if (!rows.length) return null;
  const sum = (f: (r: PerPr) => number) => rows.reduce((a, r) => a + f(r), 0);
  if (m === "volume") return sum((r) => r.comments) / rows.length;
  if (m === "precision") return sum((r) => r.comments) ? sum((r) => r.matched) / sum((r) => r.comments) : null;
  return sum((r) => r.humanComments) ? sum((r) => r.humanCovered) / sum((r) => r.humanComments) : null;
}

const H = 240, PL = 44, PR = 16, PT = 14, PB = 30;
const SERIES = [
  { key: "on", name: "Memory on", color: "var(--viz-on)" },
  { key: "off", name: "Memory off", color: "var(--viz-off)" },
] as const;

export default function LearningCurve({ off, on, window: win }: { off: ArmSummary; on: ArmSummary; window: number }) {
  const [metric, setMetric] = useState<Metric>("volume");
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [w, setW] = useState(640);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const meta = METRICS.find((m) => m.id === metric)!;
  const n = Math.max(off.series.length, on.series.length, 2);
  const data = { on: on.series, off: off.series };
  const vals = (k: "on" | "off") => Array.from({ length: n }, (_, i) => windowed(data[k], i, win, metric));
  const v = { on: vals("on"), off: vals("off") };
  const all = [...v.on, ...v.off].filter((x): x is number => x !== null);
  const rawMax = Math.max(0.001, ...all);
  const max = meta.pct ? Math.max(0.2, Math.ceil((rawMax * 1.15) / 0.1) * 0.1) : Math.max(2, Math.ceil(rawMax * 1.15));
  const ticks = [0, max / 2, max];
  const fmt = (x: number | null) => (x === null ? "n/a" : meta.pct ? `${Math.round(x * 100)}%` : x.toFixed(1));

  const X = (i: number) => PL + (i / (n - 1)) * (w - PL - PR);
  const Y = (x: number) => PT + (1 - x / max) * (H - PT - PB);
  const line = (a: (number | null)[]) => {
    let d = "", pen = false;
    a.forEach((x, i) => { if (x === null) { pen = false; return; } d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(x).toFixed(1)} `; pen = true; });
    return d;
  };
  const last = (a: (number | null)[]) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null) return i; return -1; };

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - PL) / (w - PL - PR)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
    else if (e.key === "Escape") setHover(null);
  }

  // End labels only when the two lines end far enough apart not to collide.
  const endOn = last(v.on), endOff = last(v.off);
  const sep = endOn >= 0 && endOff >= 0 ? Math.abs(Y(v.on[endOn]!) - Y(v.off[endOff]!)) : 0;
  const showEndLabels = sep > 16;

  return (
    <figure className="rounded-xl border p-4 sm:p-5" style={{ background: "var(--viz-surface)", borderColor: "var(--viz-grid)", color: "var(--viz-ink)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div role="tablist" aria-label="Metric" className="flex flex-wrap gap-1.5">
          {METRICS.map((m) => (
            <button key={m.id} role="tab" aria-selected={metric === m.id} onClick={() => setMetric(m.id)}
              className="rounded-md px-2.5 py-1 text-xs border transition-colors"
              style={{ borderColor: "var(--viz-axis)", background: metric === m.id ? "var(--viz-ink)" : "transparent", color: metric === m.id ? "var(--viz-surface)" : "var(--viz-ink-2)" }}>
              {m.label}
            </button>
          ))}
        </div>
        <button onClick={() => setTable((t) => !t)} className="text-xs underline" style={{ color: "var(--viz-ink-2)" }}>
          {table ? "View as chart" : "View as table"}
        </button>
      </div>
      <figcaption className="text-sm mb-3" style={{ color: "var(--viz-ink-2)" }}>
        {meta.title}, trailing {win} PRs
      </figcaption>

      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr style={{ color: "var(--viz-ink-2)" }}><th className="text-left font-medium py-1">PR in replay</th><th className="text-right font-medium">Memory on</th><th className="text-right font-medium">Memory off</th></tr></thead>
            <tbody className="tabular-nums">
              {Array.from({ length: n }, (_, i) => (
                <tr key={i} className="border-t" style={{ borderColor: "var(--viz-grid)" }}>
                  <td className="py-1">{i + 1}</td><td className="text-right">{fmt(v.on[i])}</td><td className="text-right">{fmt(v.off[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrap} className="relative min-w-0">
          <svg width={w} height={H} role="img" tabIndex={0} onKeyDown={onKey} onBlur={() => setHover(null)}
            aria-label={`${meta.title}. Memory on ends at ${fmt(endOn >= 0 ? v.on[endOn] : null)}, memory off at ${fmt(endOff >= 0 ? v.off[endOff] : null)}. Use the left and right arrow keys to read each PR, or switch to the table view.`}
            onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="block max-w-full touch-pan-y outline-offset-4">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PL} x2={w - PR} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
                <text x={PL - 8} y={Y(t) + 4} textAnchor="end" fontSize="11" fill="var(--viz-muted)" className="tabular-nums">{fmt(t)}</text>
              </g>
            ))}
            <text x={PL} y={H - 8} fontSize="11" fill="var(--viz-muted)">PR 1</text>
            <text x={w - PR} y={H - 8} textAnchor="end" fontSize="11" fill="var(--viz-muted)">PR {n}</text>

            {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={PT} y2={H - PB} stroke="var(--viz-axis)" strokeWidth={1} />}

            {SERIES.map((s) => {
              const a = v[s.key], e = last(a);
              return (
                <g key={s.key}>
                  <path d={line(a)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {e >= 0 && <circle cx={X(e)} cy={Y(a[e]!)} r={4.5} fill={s.color} stroke="var(--viz-surface)" strokeWidth={2} />}
                  {hover !== null && a[hover] !== null && <circle cx={X(hover)} cy={Y(a[hover]!)} r={4.5} fill={s.color} stroke="var(--viz-surface)" strokeWidth={2} />}
                </g>
              );
            })}
            {showEndLabels && SERIES.map((s) => {
              const a = v[s.key], e = last(a);
              return e >= 0 ? <text key={s.key} x={X(e) - 10} y={Y(a[e]!) + (s.key === "on" ? (Y(a[e]!) < PT + 24 ? 20 : -10) : (Y(a[e]!) < PT + 24 ? 20 : -10))} textAnchor="end" fontSize="12" fill="var(--viz-ink-2)">{s.name}</text> : null;
            })}
          </svg>

          {hover !== null && (
            <div role="status" className="pointer-events-none absolute z-10 rounded-lg border px-3 py-2 text-xs shadow-sm"
              style={{ left: Math.min(Math.max(X(hover) + 12, 0), w - 150), top: 4, background: "var(--viz-surface)", borderColor: "var(--viz-axis)" }}>
              <div style={{ color: "var(--viz-muted)" }} className="mb-1">PR {hover + 1} of {n}</div>
              {SERIES.map((s) => (
                <div key={s.key} className="flex items-center gap-2">
                  <i className="inline-block h-[2px] w-3 rounded" style={{ background: s.color }} />
                  <strong className="tabular-nums" style={{ color: "var(--viz-ink)" }}>{fmt(v[s.key][hover])}</strong>
                  <span style={{ color: "var(--viz-ink-2)" }}>{s.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs" style={{ color: "var(--viz-ink-2)" }}>
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5"><i className="inline-block h-[2px] w-4 rounded" style={{ background: s.color }} />{s.name}</span>
        ))}
      </div>
    </figure>
  );
}
