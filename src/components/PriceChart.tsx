"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import { fill, useI18n } from "@/lib/i18n";
import { fmtBig, fmtDate, fmtNum, fmtPct, fmtPrice } from "@/lib/format";
import { bollinger, macd, rsi, sma, type Series } from "@/lib/indicators";
import {
  INDICATORS,
  PANE_INDS,
  RANGES,
  RANGE_SESSIONS,
  chartHeight,
  visibleWindow,
  type ChartSettings,
  type Ind,
} from "@/lib/chartSettings";
import type { Candle } from "@/lib/types";
import { ChevronDownIcon, SlidersIcon } from "./icons";
import { Explain, Segmented, ToggleChip } from "./ui";

export interface ChartLevel {
  price: number;
  kind: "support" | "resistance";
}

const NO_LEVELS: ChartLevel[] = [];

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function palette() {
  return {
    bg: cssVar("--panel"),
    text: cssVar("--muted"),
    grid: cssVar("--border"),
    up: cssVar("--up"),
    down: cssVar("--down"),
    accent: cssVar("--accent"),
    info: cssVar("--info"),
    warn: cssVar("--warn"),
  };
}
type Palette = ReturnType<typeof palette>;

/** Re-renders when the app theme or the system theme changes. */
function useThemeVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((x) => x + 1);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("iep-theme", bump);
    mq.addEventListener("change", bump);
    return () => {
      window.removeEventListener("iep-theme", bump);
      mq.removeEventListener("change", bump);
    };
  }, []);
  return v;
}

type AnySeries = ISeriesApi<SeriesType, Time>;

/**
 * Price chart with indicators.
 * Lifecycle: ONE chart instance per mount. Series are added or removed through the chart
 * API when the style or indicators change; the theme and language only update options;
 * the range only moves the visible window. So zoom and pan survive theme switches, and
 * nothing is rebuilt that doesn't have to be.
 * Indicators are computed on the full history and every series holds the full history, so
 * a 200-day average is already "warm" on the first visible bar of any range.
 */
export default function PriceChart({
  history,
  levels = NO_LEVELS,
  settings,
  onSettings,
}: {
  history: Candle[];
  levels?: ChartLevel[];
  settings: ChartSettings;
  onSettings: (s: ChartSettings) => void;
}) {
  const { t, lang } = useI18n();
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<AnySeries | null>(null);
  const overlayRef = useRef(new Map<Ind, AnySeries[]>());
  const paneRef = useRef<{ key: string; series: AnySeries[] }>({ key: "", series: [] });
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const colorsRef = useRef<Palette | null>(null);
  const captionId = useId();
  const themeV = useThemeVersion();
  const [hover, setHover] = useState<number | null>(null); // bar index under the crosshair
  const [showInds, setShowInds] = useState(false); // narrow screens: indicators panel
  const { range, style, inds } = settings;

  const indexByTime = useMemo(() => new Map(history.map((c, i) => [c.time, i])), [history]);
  const computed = useMemo(() => {
    const closes = history.map((c) => c.close);
    return { sma50: sma(closes, 50), sma200: sma(closes, 200), bb: bollinger(closes), rsi: rsi(closes), macd: macd(closes) };
  }, [history]);

  // ---- Create once -----------------------------------------------------------------------
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const c = palette();
    colorsRef.current = c;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: c.bg },
        textColor: c.text,
        fontSize: 11,
        attributionLogo: true, // TradingView attribution required by the library licence
        panes: { separatorColor: c.grid, separatorHoverColor: c.grid },
      },
      grid: { vertLines: { color: c.grid + "55" }, horzLines: { color: c.grid + "55" } },
      rightPriceScale: { borderColor: c.grid },
      timeScale: { borderColor: c.grid, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: 0 },
      handleScroll: { vertTouchDrag: false }, // vertical swipes keep scrolling the page
    });
    chartRef.current = chart;
    let frame = 0;
    const onMove = (p: MouseEventParams<Time>) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setHover(p.time === undefined ? null : (indexByTimeRef.current.get(p.time as string) ?? null)));
    };
    chart.subscribeCrosshairMove(onMove);
    const overlays = overlayRef.current;
    return () => {
      cancelAnimationFrame(frame);
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove(); // removes canvases, observers and listeners
      chartRef.current = null;
      mainRef.current = null;
      overlays.clear();
      paneRef.current = { key: "", series: [] };
      priceLinesRef.current = [];
    };
  }, []);
  const indexByTimeRef = useRef(indexByTime);
  indexByTimeRef.current = indexByTime;

  // ---- Theme and language: options only ------------------------------------------------
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const c = palette();
    colorsRef.current = c;
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: c.bg }, textColor: c.text, panes: { separatorColor: c.grid, separatorHoverColor: c.grid } },
      grid: { vertLines: { color: c.grid + "55" }, horzLines: { color: c.grid + "55" } },
      rightPriceScale: { borderColor: c.grid },
      timeScale: { borderColor: c.grid },
      localization: { locale: lang === "es" ? "es-US" : "en-US" },
    });
    const main = mainRef.current;
    if (main) {
      if (style === "candles") main.applyOptions({ upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
      else main.applyOptions({ color: c.accent });
    }
    // Indicator colours are re-applied by rebuilding their (cheap) series: see below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeV, lang]);

  // ---- Main series: replaced only when the style changes ---------------------------------
  useEffect(() => {
    const chart = chartRef.current;
    const c = colorsRef.current;
    if (!chart || !c) return;
    if (mainRef.current) chart.removeSeries(mainRef.current);
    priceLinesRef.current = [];
    const main: AnySeries =
      style === "candles"
        ? chart.addSeries(CandlestickSeries, { upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down, borderVisible: false }, 0)
        : chart.addSeries(LineSeries, { color: c.accent, lineWidth: 2, priceLineVisible: false }, 0);
    if (style === "candles") main.setData(history.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    else main.setData(history.map(({ time, close }) => ({ time, value: close })));
    mainRef.current = main;
    drawLevels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, history]);

  // ---- Support / resistance lines ---------------------------------------------------------
  const drawLevels = () => {
    const main = mainRef.current;
    const c = colorsRef.current;
    if (!main || !c) return;
    for (const l of priceLinesRef.current) main.removePriceLine(l);
    priceLinesRef.current = levels.map((l) =>
      main.createPriceLine({
        price: l.price,
        color: l.kind === "support" ? c.up : c.down,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: l.kind === "support" ? t.chart.supportShort : t.chart.resistanceShort,
      }),
    );
  };
  useEffect(drawLevels, [levels, t]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Overlay indicators (main pane): added/removed one by one ---------------------------
  const line = (s: Series) => s.flatMap((v, i) => (v == null ? [] : [{ time: history[i].time, value: v }]));
  const thin = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };

  function rebuildOverlays(force = false) {
    const chart = chartRef.current;
    const c = colorsRef.current;
    if (!chart || !c) return;
    const current = overlayRef.current;
    for (const ind of ["volume", "sma", "bb"] as Ind[]) {
      const want = inds.includes(ind);
      const have = current.get(ind);
      if (have && (!want || force)) {
        have.forEach((s) => chart.removeSeries(s));
        current.delete(ind);
      }
      if (!want || current.has(ind)) continue;
      if (ind === "volume") {
        const v = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false }, 0);
        v.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        v.setData(history.map((d) => ({ time: d.time, value: d.volume, color: (d.close >= d.open ? c.up : c.down) + "55" })));
        current.set(ind, [v]);
      } else if (ind === "sma") {
        const a = chart.addSeries(LineSeries, { ...thin, color: c.info, lineWidth: 2 }, 0);
        a.setData(line(computed.sma50));
        const b = chart.addSeries(LineSeries, { ...thin, color: c.warn, lineWidth: 2 }, 0);
        b.setData(line(computed.sma200));
        current.set(ind, [a, b]);
      } else {
        const series = [computed.bb.upper, computed.bb.lower].map((s) => {
          const x = chart.addSeries(LineSeries, { ...thin, color: c.text, lineStyle: LineStyle.Dotted }, 0);
          x.setData(line(s));
          return x;
        });
        current.set(ind, series);
      }
    }
  }

  // ---- Pane indicators (RSI, MACD): rebuilt together when that set changes ----------------
  function rebuildPanes(force = false) {
    const chart = chartRef.current;
    const c = colorsRef.current;
    if (!chart || !c) return;
    const want = PANE_INDS.filter((i) => inds.includes(i));
    const key = want.join(",");
    if (!force && key === paneRef.current.key) return;
    paneRef.current.series.forEach((s) => chart.removeSeries(s)); // empty panes go away with them
    const series: AnySeries[] = [];
    let pane = 1;
    if (want.includes("rsi")) {
      const r = chart.addSeries(LineSeries, { ...thin, color: c.accent, lastValueVisible: true }, pane);
      r.setData(line(computed.rsi));
      for (const p of [70, 30]) r.createPriceLine({ price: p, color: c.text, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "" });
      series.push(r);
      pane++;
    }
    if (want.includes("macd")) {
      const h = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
      h.setData(computed.macd.hist.flatMap((v, i) => (v == null ? [] : [{ time: history[i].time, value: v, color: (v >= 0 ? c.up : c.down) + "aa" }])));
      const l = chart.addSeries(LineSeries, { ...thin, color: c.info }, pane);
      l.setData(line(computed.macd.line));
      const s = chart.addSeries(LineSeries, { ...thin, color: c.warn }, pane);
      s.setData(line(computed.macd.signal));
      series.push(h, l, s);
    }
    paneRef.current = { key, series };
    const panes = chart.panes();
    panes[0]?.setStretchFactor(3);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);
  }

  // Indicators: toggled one by one; rebuilt in full only when their data, the theme or the
  // main series changed (a re-added main series would otherwise cover the overlays).
  const builtFor = useRef<{ computed: unknown; themeV: number; style: string } | null>(null);
  useEffect(() => {
    const b = builtFor.current;
    const force = !b || b.computed !== computed || b.themeV !== themeV || b.style !== style;
    builtFor.current = { computed, themeV, style };
    rebuildOverlays(force);
    rebuildPanes(force);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inds, computed, themeV, style]);

  // ---- Range: only the visible window moves -----------------------------------------------
  useEffect(() => {
    chartRef.current?.timeScale().setVisibleLogicalRange(visibleWindow(history.length, range));
  }, [range, history]);

  // ---- Text: legend, available span, summary ---------------------------------------------
  const n = history.length;
  const span = Math.min(n, RANGE_SESSIONS[range]);
  const visible = history.slice(n - span);
  const firstC = visible[0];
  const lastC = visible[visible.length - 1];
  const shortHistory = range !== "5Y" && n < RANGE_SESSIONS[range];
  const summary =
    firstC && lastC
      ? fill(t.chart.a11ySummary, {
          range: t.chart.rangeNames[range],
          chg: fmtPct(((lastC.close - firstC.close) / firstC.close) * 100, lang, { sign: true }),
          last: fmtPrice(lastC.close, lang),
          date: fmtDate(lastC.time, lang),
          hi: fmtPrice(Math.max(...visible.map((c) => c.high)), lang),
          lo: fmtPrice(Math.min(...visible.map((c) => c.low)), lang),
        })
      : "";

  const hi = hover ?? n - 1;
  const bar = history[hi];
  const prev = history[hi - 1];
  const set = (patch: Partial<ChartSettings>) => onSettings({ ...settings, ...patch });
  const toggle = (k: Ind) => set({ inds: inds.includes(k) ? inds.filter((x) => x !== k) : INDICATORS.filter((x) => x === k || inds.includes(x)) });
  const active = INDICATORS.filter((k) => inds.includes(k));

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 mb-3">
        <ControlGroup label={t.chart.rangeLabel}>
          <Segmented
            label={t.chart.rangeLabel}
            value={range}
            onChange={(r) => set({ range: r })}
            options={RANGES.map((r) => ({ value: r, label: t.chart.ranges[r], title: t.chart.rangeNames[r] }))}
          />
        </ControlGroup>
        <ControlGroup label={t.chart.styleLabel}>
          <Segmented
            label={t.chart.styleLabel}
            value={style}
            onChange={(s) => set({ style: s })}
            options={[
              { value: "candles", label: t.chart.candles },
              { value: "line", label: t.chart.line },
            ]}
          />
        </ControlGroup>
        <button
          type="button"
          className="sm:hidden ml-auto inline-flex items-center gap-2 h-11 px-3 rounded-lg border border-line text-sm font-semibold"
          aria-expanded={showInds}
          aria-controls={`${captionId}-inds`}
          onClick={() => setShowInds((v) => !v)}
        >
          <SlidersIcon size={18} />
          {t.chart.indicators}
          {active.length > 0 && <span className="num text-xs text-muted">({active.length})</span>}
          <ChevronDownIcon size={16} className={showInds ? "rotate-180" : ""} />
        </button>
      </div>
      <div id={`${captionId}-inds`} className={`${showInds ? "block" : "hidden"} sm:block mb-3`}>
        <p className="hidden sm:block control-label mb-1.5">{t.chart.indicators}</p>
        <div role="group" aria-label={t.chart.indicators} className="flex flex-wrap gap-2">
          {INDICATORS.map((k) => (
            <ToggleChip key={k} on={inds.includes(k)} onClick={() => toggle(k)}>
              {t.chart[k].name}
            </ToggleChip>
          ))}
        </div>
      </div>

      {/* Crosshair legend: the bar under the pointer, or the latest one. */}
      {bar && (
        <div className="num flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs mb-1.5 min-h-5" aria-hidden="true">
          <span className="font-semibold">{fmtDate(bar.time, lang)}</span>
          {style === "candles" && (
            <>
              <span><span className="text-muted">{t.chart.ohlc.o}</span> {fmtNum(bar.open, lang)}</span>
              <span><span className="text-muted">{t.chart.ohlc.h}</span> {fmtNum(bar.high, lang)}</span>
              <span><span className="text-muted">{t.chart.ohlc.l}</span> {fmtNum(bar.low, lang)}</span>
            </>
          )}
          <span><span className="text-muted">{t.chart.ohlc.c}</span> {fmtNum(bar.close, lang)}</span>
          {prev && (
            <span className={bar.close >= prev.close ? "text-up" : "text-down"}>
              {fmtPct(((bar.close - prev.close) / prev.close) * 100, lang, { sign: true }).replace("-", "−")}
            </span>
          )}
          {inds.includes("sma") && computed.sma50[hi] != null && (
            <span className="text-info">SMA50 {fmtNum(computed.sma50[hi]!, lang)}</span>
          )}
          {inds.includes("sma") && computed.sma200[hi] != null && (
            <span className="text-warn">SMA200 {fmtNum(computed.sma200[hi]!, lang)}</span>
          )}
          {inds.includes("volume") && <span><span className="text-muted">{t.chart.volume.name}</span> {fmtBig(bar.volume)}</span>}
        </div>
      )}

      <figure aria-labelledby={captionId} className="m-0">
        <div ref={elRef} className="w-full rounded-lg overflow-hidden border border-line touch-pan-y" style={{ height: chartHeight(inds) }} />
        <figcaption id={captionId} className="sr-only">
          {summary}
        </figcaption>
      </figure>
      <p className="mt-1.5 text-[11px] text-muted">
        {shortHistory
          ? fill(t.chart.shortHistory, { from: fmtDate(history[0].time, lang), n })
          : fill(t.chart.span, { from: fmtDate(firstC?.time ?? "", lang), to: fmtDate(lastC?.time ?? "", lang) })}
      </p>

      <ChartData history={visible} lang={lang} />

      {active.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {active.map((k) => (
            <div key={k} className="rounded-lg bg-panel-2 px-3 py-2">
              <p className="text-sm font-semibold flex items-center gap-2">
                {k === "sma" ? (
                  <>
                    <span className="h-0.5 w-4 bg-info inline-block" aria-hidden="true" /> {t.chart.sma50}
                    <span className="h-0.5 w-4 bg-warn inline-block" aria-hidden="true" /> {t.chart.sma200}
                  </>
                ) : (
                  t.chart[k].name
                )}
              </p>
              <Explain>{t.chart[k].text}</Explain>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="control-label mb-1.5" aria-hidden="true">
        {label}
      </p>
      {children}
    </div>
  );
}

/** The numbers behind the chart, for screen readers, keyboard users and checking. */
function ChartData({ history, lang }: { history: Candle[]; lang: "es" | "en" }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // Long ranges: one row per week (the week's last session) keeps the table readable.
  const weekly = history.length > 260;
  const rows = useMemo(() => {
    if (!open) return [];
    const src = weekly
      ? history.filter((c, i) => {
          const next = history[i + 1];
          return !next || new Date(next.time + "T00:00:00Z").getUTCDay() < new Date(c.time + "T00:00:00Z").getUTCDay();
        })
      : history;
    return [...src].reverse();
  }, [open, history, weekly]);
  return (
    <details className="mt-2 text-xs" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer select-none link inline-flex items-center min-h-8">{t.chart.dataTable}</summary>
      {open && (
        <div className="relative mt-1 max-h-72 overflow-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label={t.chart.dataTable}>
          <table className="num w-full">
            <caption className="sr-only">{weekly ? t.chart.weeklyCaption : t.chart.dailyCaption}</caption>
            <thead className="sticky top-0 bg-panel">
              <tr className="text-muted">
                {[t.chart.cols.date, t.chart.cols.open, t.chart.cols.high, t.chart.cols.low, t.chart.cols.close, t.chart.cols.volume].map((h, i) => (
                  <th key={h} scope="col" className={`px-2 py-1.5 font-normal ${i ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.time} className="border-t border-line">
                  <th scope="row" className="px-2 py-1 text-left font-normal">{fmtDate(c.time, lang)}</th>
                  <td className="px-2 py-1 text-right">{fmtNum(c.open, lang)}</td>
                  <td className="px-2 py-1 text-right">{fmtNum(c.high, lang)}</td>
                  <td className="px-2 py-1 text-right">{fmtNum(c.low, lang)}</td>
                  <td className="px-2 py-1 text-right">{fmtNum(c.close, lang)}</td>
                  <td className="px-2 py-1 text-right">{fmtBig(c.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {weekly && <p className="px-2 py-1.5 text-muted">{t.chart.weeklyNote}</p>}
        </div>
      )}
    </details>
  );
}
