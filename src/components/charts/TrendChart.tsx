"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { niceTicks } from "@/lib/chartMetrics";

// A small, dependency-free SVG chart for period series (fiscal years, quarters, months).
// Follows one visual system: one y-axis, hairline solid grid, 2px lines, columns at most
// 24px with a rounded data end and square baseline, 2px gaps between touching bars, a
// crosshair that snaps to the nearest period, and the same readout on keyboard focus.

export interface ChartSeries {
  id: string;
  label: string;
  colorVar: string; // e.g. "--series-1"
  /** Second and third metric of the same company: dashed/dotted line, lighter bar. */
  variant?: 0 | 1 | 2;
  values: (number | null)[];
}

export interface ChartColors {
  series: Record<string, string>;
  text: string;
  muted: string;
  grid: string;
  axis: string;
  surface: string;
}

/** Resolved theme colours (literal values, so the SVG also exports as an image). */
export function useChartColors(vars: string[]): ChartColors | null {
  const [colors, setColors] = useState<ChartColors | null>(null);
  const key = vars.join(",");
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const v = (n: string) => cs.getPropertyValue(n).trim();
      setColors({
        series: Object.fromEntries(key.split(",").filter(Boolean).map((n) => [n, v(n)])),
        text: v("--text"),
        muted: v("--muted"),
        grid: v("--grid"),
        axis: v("--axis"),
        surface: v("--panel"),
      });
    };
    read();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("iep-theme", read);
    mq.addEventListener("change", read);
    return () => {
      window.removeEventListener("iep-theme", read);
      mq.removeEventListener("change", read);
    };
  }, [key]);
  return colors;
}

const DASH = [undefined, "6 4", "1.5 3.5"] as const;
const FILL = [1, 0.6, 0.32] as const;

/** Legend/tooltip key that matches the mark: a short line (dashed per variant) or a square. */
export function Swatch({ kind, color, variant = 0 }: { kind: "line" | "bar"; color: string; variant?: 0 | 1 | 2 }) {
  return (
    <svg width={kind === "bar" ? 10 : 16} height={10} aria-hidden="true" className="shrink-0">
      {kind === "bar" ? (
        <rect width={10} height={10} rx={3} fill={color} fillOpacity={FILL[variant]} />
      ) : (
        <line x1={1} x2={15} y1={5} y2={5} stroke={color} strokeWidth={2} strokeLinecap="round" strokeDasharray={DASH[variant]} />
      )}
    </svg>
  );
}

export interface TrendChartHandle {
  svg: SVGSVGElement | null;
}

interface Props {
  categories: string[];
  categoryLabel: (k: string) => string; // axis (short)
  categoryTitle?: (k: string) => string; // tooltip (full); defaults to the axis label
  series: ChartSeries[]; // visible series only
  kind: "line" | "bar";
  colors: ChartColors;
  format: (v: number) => string; // tooltip values
  formatTick: (v: number, step: number) => string; // step between ticks, to pick decimals
  reference?: number; // e.g. 100 for an index
  ariaLabel: string;
  height?: number;
}

const FONT = "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif";
const CHAR_W = 6.6; // average width of a 11.5px figure, for layout before measuring

const TrendChart = forwardRef<TrendChartHandle, Props>(function TrendChart(
  { categories, categoryLabel, categoryTitle, series, kind, colors, format, formatTick, reference, ariaLabel, height = 320 },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipId = useId();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  useImperativeHandle(ref, () => ({ svg: svgRef.current }), []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = categories.length;
  const layout = useMemo(() => {
    const vals = series.flatMap((s) => s.values.filter((v): v is number => v != null && Number.isFinite(v)));
    let min = vals.length ? Math.min(...vals) : 0;
    let max = vals.length ? Math.max(...vals) : 1;
    if (kind === "bar" || min < 0) {
      min = Math.min(min, 0);
      max = Math.max(max, 0);
    }
    if (reference !== undefined) {
      min = Math.min(min, reference);
      max = Math.max(max, reference);
    }
    const ticks = niceTicks(min, max, height < 280 ? 4 : 5);
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    const tickText = ticks.map((t) => formatTick(t, step));
    const tickW = Math.max(...tickText.map((s) => s.length)) * CHAR_W;
    // End labels for a few lines, when they fit without colliding.
    const endLabels = kind === "line" && series.length >= 2 && series.length <= 4 && width >= 480;
    const labelW = endLabels ? Math.min(140, Math.max(...series.map((s) => s.label.length)) * 6.4 + 16) : 0;
    const m = { top: 10, right: endLabels ? labelW : 12, bottom: 30, left: Math.ceil(tickW) + 14 };
    const innerW = Math.max(10, width - m.left - m.right);
    const innerH = height - m.top - m.bottom;
    const band = n ? innerW / n : innerW;
    const x = (i: number) => m.left + band * (i + 0.5);
    const y = (v: number) => m.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
    // X labels: thin out so they never overlap; always keep the last one.
    const labelPx = Math.max(...categories.map((c) => categoryLabel(c).length), 4) * CHAR_W + 12;
    const every = Math.max(1, Math.ceil(labelPx / band));
    return { ticks, tickText, lo, hi, m, innerW, innerH, band, x, y, every, endLabels };
  }, [series, kind, reference, height, width, n, categories, categoryLabel, formatTick]);

  const { ticks, tickText, m, innerH, band, x, y, every, endLabels } = layout;
  const zeroY = y(Math.max(layout.lo, Math.min(0, layout.hi)));

  const pick = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !n) return;
    const i = Math.floor((clientX - rect.left - m.left) / band);
    setActive(Math.max(0, Math.min(n - 1, i)));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!n) return;
    const cur = active ?? n - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(n - 1, cur + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape") {
      setActive(null);
      return;
    }
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    }
  };

  // Bars: grouped per period, each at most 24px, 2px apart.
  const ns = series.length;
  const gap = 2;
  const barW = ns ? Math.max(2, Math.min(24, (band * 0.72 - gap * (ns - 1)) / ns)) : 0;
  const groupW = barW * ns + gap * (ns - 1);

  const barPath = (cx: number, v: number) => {
    const top = y(v);
    const h = Math.abs(zeroY - top);
    if (h < 0.5) return "";
    const r = Math.min(4, barW / 2, h);
    const left = cx - barW / 2;
    const right = cx + barW / 2;
    if (v >= 0) {
      return `M${left},${zeroY} V${top + r} Q${left},${top} ${left + r},${top} H${right - r} Q${right},${top} ${right},${top + r} V${zeroY} Z`;
    }
    return `M${left},${zeroY} V${top - r} Q${left},${top} ${left + r},${top} H${right - r} Q${right},${top} ${right},${top - r} V${zeroY} Z`;
  };

  const linePath = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };

  // End labels at each line's last value; dropped together if any two would collide.
  const ends = endLabels
    ? series
        .map((s) => {
          let i = s.values.length - 1;
          while (i >= 0 && s.values[i] == null) i--;
          return i < 0 ? null : { s, i, yy: y(s.values[i]!) };
        })
        .filter((e): e is { s: ChartSeries; i: number; yy: number } => !!e)
    : [];
  const sortedEnds = [...ends].sort((a, b) => a.yy - b.yy);
  const endsFit = sortedEnds.every((e, k) => k === 0 || e.yy - sortedEnds[k - 1].yy >= 14);

  const shown = active ?? (focused ? n - 1 : null);
  const tipLeft = shown !== null ? x(shown) : 0;
  const flip = tipLeft > width * 0.6;

  return (
    <div ref={wrapRef} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-roledescription="chart"
          aria-label={ariaLabel}
          aria-describedby={shown !== null ? tipId : undefined}
          tabIndex={0}
          className="block outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-sm touch-pan-y"
          style={{ fontFamily: FONT }}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
          onKeyDown={onKey}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setActive(null);
          }}
        >
          <rect width={width} height={height} fill={colors.surface} />
          {/* Grid and y-axis ticks */}
          {ticks.map((t, ti) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? colors.axis : colors.grid} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11.5} fill={colors.muted} style={{ fontVariantNumeric: "tabular-nums" }}>
                {tickText[ti]}
              </text>
            </g>
          ))}
          {reference !== undefined && (
            <line x1={m.left} x2={width - m.right} y1={y(reference)} y2={y(reference)} stroke={colors.axis} strokeWidth={1} shapeRendering="crispEdges" />
          )}
          {/* X labels */}
          {categories.map((c, i) => {
            if ((n - 1 - i) % every !== 0) return null;
            const label = categoryLabel(c);
            const half = (label.length * CHAR_W) / 2;
            const anchor = x(i) + half > width - 2 ? "end" : x(i) - half < m.left - 8 ? "start" : "middle";
            const lx = anchor === "end" ? width - 2 : anchor === "start" ? Math.max(2, x(i) - half) : x(i);
            return (
              <text key={c} x={lx} y={height - 10} textAnchor={anchor} fontSize={11.5} fill={colors.muted}>
                {label}
              </text>
            );
          })}
          {/* Hovered period */}
          {shown !== null && kind === "bar" && (
            <rect x={x(shown) - band / 2} y={m.top} width={band} height={innerH} fill={colors.grid} opacity={0.6} />
          )}
          {/* Marks */}
          {kind === "bar"
            ? series.map((s, si) =>
                s.values.map((v, i) =>
                  v == null ? null : (
                    <path key={`${s.id}-${i}`} d={barPath(x(i) - groupW / 2 + barW / 2 + si * (barW + gap), v)} fill={colors.series[s.colorVar]} fillOpacity={FILL[s.variant ?? 0]} />
                  ),
                ),
              )
            : series.map((s) => (
                <path key={s.id} d={linePath(s.values)} fill="none" stroke={colors.series[s.colorVar]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={DASH[s.variant ?? 0]} />
              ))}
          {/* Line ends and the crosshair */}
          {kind === "line" &&
            ends.map((e) => <circle key={e.s.id} cx={x(e.i)} cy={e.yy} r={4} fill={colors.series[e.s.colorVar]} stroke={colors.surface} strokeWidth={2} />)}
          {kind === "line" && endsFit &&
            sortedEnds.map((e) => (
              <text key={e.s.id} x={x(e.i) + 9} y={e.yy} dy="0.32em" fontSize={11.5} fill={colors.text}>
                {e.s.label.length > 18 ? e.s.label.slice(0, 17) + "…" : e.s.label}
              </text>
            ))}
          {shown !== null && kind === "line" && (
            <g>
              <line x1={x(shown)} x2={x(shown)} y1={m.top} y2={m.top + innerH} stroke={colors.axis} strokeWidth={1} shapeRendering="crispEdges" />
              {series.map((s) =>
                s.values[shown] == null ? null : (
                  <circle key={s.id} cx={x(shown)} cy={y(s.values[shown]!)} r={4} fill={colors.series[s.colorVar]} stroke={colors.surface} strokeWidth={2} />
                ),
              )}
            </g>
          )}
        </svg>
      )}
      {shown !== null && (
        <div
          id={tipId}
          role="status"
          className="pointer-events-none absolute top-2 z-10 min-w-40 max-w-64 rounded-lg border border-line bg-panel px-3 py-2 text-[13px] shadow-lg"
          style={flip ? { right: Math.max(4, width - tipLeft + 12) } : { left: Math.min(tipLeft + 12, Math.max(4, width - 200)) }}
        >
          <p className="mb-1 text-xs text-muted">{(categoryTitle ?? categoryLabel)(categories[shown])}</p>
          <ul className="space-y-0.5">
            {series.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <Swatch kind={kind} color={colors.series[s.colorVar]} variant={s.variant} />
                <span className="num font-semibold">{s.values[shown] == null ? "—" : format(s.values[shown]!)}</span>
                <span className="truncate text-muted">{s.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

export default TrendChart;
