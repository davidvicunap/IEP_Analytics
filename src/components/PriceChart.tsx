"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
} from "lightweight-charts";
import { fill, useI18n } from "@/lib/i18n";
import { fmtDate, fmtPct, fmtPrice } from "@/lib/format";
import { bollinger, macd, rsi, sma, type Series } from "@/lib/indicators";
import type { Candle } from "@/lib/types";
import { Explain } from "./ui";

type Range = "1M" | "6M" | "1Y" | "5Y";
type Ind = "sma" | "bb" | "rsi" | "macd" | "volume";
const RANGE_DAYS: Record<Range, number> = { "1M": 22, "6M": 126, "1Y": 252, "5Y": 100000 };

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

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

export interface ChartLevel {
  price: number;
  kind: "support" | "resistance";
}

const NO_LEVELS: ChartLevel[] = []; // stable default: a new [] each render would rebuild the chart

export default function PriceChart({ history, levels = NO_LEVELS }: { history: Candle[]; levels?: ChartLevel[] }) {
  const { t, lang } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const captionId = useId();
  const [range, setRange] = useState<Range>("1Y");
  const [style, setStyle] = useState<"candles" | "line">("candles");
  const [inds, setInds] = useState<Set<Ind>>(() => new Set<Ind>(["sma", "volume"]));
  const themeV = useThemeVersion();

  // Indicators are computed on the full history, then sliced, so long averages exist from the first visible bar.
  const computed = useMemo(() => {
    const closes = history.map((c) => c.close);
    return {
      sma50: sma(closes, 50),
      sma200: sma(closes, 200),
      bb: bollinger(closes),
      rsi: rsi(closes),
      macd: macd(closes),
    };
  }, [history]);

  const toggle = (k: Ind) =>
    setInds((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const extraPanes = (inds.has("rsi") ? 1 : 0) + (inds.has("macd") ? 1 : 0);

  useEffect(() => {
    const el = ref.current;
    if (!el || history.length === 0) return;

    const c = {
      bg: cssVar("--panel"),
      text: cssVar("--muted"),
      grid: cssVar("--border"),
      up: cssVar("--up"),
      down: cssVar("--down"),
      accent: cssVar("--accent"),
      info: cssVar("--info"),
      warn: cssVar("--warn"),
    };

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: c.bg },
        textColor: c.text,
        fontSize: 11,
        attributionLogo: true,
        panes: { separatorColor: c.grid, separatorHoverColor: c.grid },
      },
      localization: { locale: lang === "es" ? "es-US" : "en-US" },
      grid: { vertLines: { color: c.grid + "55" }, horzLines: { color: c.grid + "55" } },
      rightPriceScale: { borderColor: c.grid },
      timeScale: { borderColor: c.grid, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: 0 },
      handleScroll: { vertTouchDrag: false },
    });

    const start = Math.max(0, history.length - RANGE_DAYS[range]);
    const slice = history.slice(start);
    const line = (s: Series) =>
      s.slice(start).flatMap((v, i) => (v == null ? [] : [{ time: slice[i].time, value: v }]));
    const thin = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };

    const main =
      style === "candles"
        ? chart.addSeries(CandlestickSeries, { upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down, borderVisible: false })
        : chart.addSeries(LineSeries, { color: c.accent, lineWidth: 2, priceLineVisible: false });
    if (style === "candles") main.setData(slice.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    else main.setData(slice.map(({ time, close }) => ({ time, value: close })));
    // Support and resistance zones, when the user asks for them.
    for (const l of levels) {
      main.createPriceLine({
        price: l.price,
        color: l.kind === "support" ? c.up : c.down,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: l.kind === "support" ? "S" : "R",
      });
    }

    if (inds.has("volume")) {
      const v = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      v.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      v.setData(slice.map((d) => ({ time: d.time, value: d.volume, color: (d.close >= d.open ? c.up : c.down) + "55" })));
    }
    if (inds.has("sma")) {
      chart.addSeries(LineSeries, { ...thin, color: c.info, lineWidth: 2 }).setData(line(computed.sma50));
      chart.addSeries(LineSeries, { ...thin, color: c.warn, lineWidth: 2 }).setData(line(computed.sma200));
    }
    if (inds.has("bb")) {
      for (const s of [computed.bb.upper, computed.bb.lower]) {
        chart.addSeries(LineSeries, { ...thin, color: c.text, lineStyle: LineStyle.Dotted }).setData(line(s));
      }
    }

    let pane = 1;
    if (inds.has("rsi")) {
      const r = chart.addSeries(LineSeries, { ...thin, color: c.accent, lastValueVisible: true }, pane);
      r.setData(line(computed.rsi));
      for (const p of [70, 30]) r.createPriceLine({ price: p, color: c.text, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "" });
      pane++;
    }
    if (inds.has("macd")) {
      const h = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
      h.setData(
        computed.macd.hist.slice(start).flatMap((v, i) => (v == null ? [] : [{ time: slice[i].time, value: v, color: (v >= 0 ? c.up : c.down) + "aa" }])),
      );
      chart.addSeries(LineSeries, { ...thin, color: c.info }, pane).setData(line(computed.macd.line));
      chart.addSeries(LineSeries, { ...thin, color: c.warn }, pane).setData(line(computed.macd.signal));
    }
    const panes = chart.panes();
    // Main price pane gets most of the space; each indicator pane a fixed share.
    panes[0]?.setStretchFactor(3);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);

    chart.timeScale().fitContent();
    return () => {
      chart.remove();
    };
  }, [history, computed, range, style, inds, themeV, lang, levels]);

  const chip = (on: boolean) =>
    `h-9 px-3 rounded-md text-xs font-semibold border transition-colors ${on ? "bg-accent text-accent-fg border-accent" : "border-line bg-panel hover:bg-panel-2"}`;

  const IND_LIST: Ind[] = ["sma", "bb", "rsi", "macd", "volume"];
  const active = IND_LIST.filter((k) => inds.has(k));

  // Text alternative for screen readers: what a sighted user reads off the chart.
  const visible = history.slice(Math.max(0, history.length - RANGE_DAYS[range]));
  const firstC = visible[0];
  const lastC = visible[visible.length - 1];
  const summary =
    firstC && lastC
      ? fill(t.chart.a11ySummary, {
          range: t.chart.ranges[range],
          chg: fmtPct(((lastC.close - firstC.close) / firstC.close) * 100, lang, { sign: true }),
          last: fmtPrice(lastC.close, lang),
          date: fmtDate(lastC.time, lang),
          hi: fmtPrice(Math.max(...visible.map((c) => c.high)), lang),
          lo: fmtPrice(Math.min(...visible.map((c) => c.low)), lang),
        })
      : "";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div role="group" aria-label="Range" className="flex gap-1">
          {(Object.keys(RANGE_DAYS) as Range[]).map((r) => (
            <button key={r} type="button" className={chip(range === r)} aria-pressed={range === r} onClick={() => setRange(r)}>
              {t.chart.ranges[r]}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Style" className="flex gap-1 ml-auto">
          <button type="button" className={chip(style === "candles")} aria-pressed={style === "candles"} onClick={() => setStyle("candles")}>{t.chart.candles}</button>
          <button type="button" className={chip(style === "line")} aria-pressed={style === "line"} onClick={() => setStyle("line")}>{t.chart.line}</button>
        </div>
      </div>

      <figure aria-labelledby={captionId} className="m-0">
        <div
          ref={ref}
          className="w-full rounded-lg overflow-hidden border border-line"
          style={{ height: `calc(clamp(280px, 45vh, 440px) + ${extraPanes * 110}px)` }}
        />
        <figcaption id={captionId} className="sr-only">
          {summary}
        </figcaption>
      </figure>

      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">{t.chart.indicators}</p>
        <div className="flex flex-wrap gap-2">
          {IND_LIST.map((k) => (
            <button key={k} type="button" className={chip(inds.has(k))} aria-pressed={inds.has(k)} onClick={() => toggle(k)}>
              {t.chart[k].name}
            </button>
          ))}
        </div>
        {active.length > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {active.map((k) => (
              <div key={k} className="rounded-lg bg-panel-2 p-3">
                <p className="text-sm font-semibold flex items-center gap-2">
                  {k === "sma" && (
                    <>
                      <span className="h-0.5 w-4 bg-info inline-block" aria-hidden="true" /> 50
                      <span className="h-0.5 w-4 bg-warn inline-block" aria-hidden="true" /> 200
                    </>
                  )}
                  {k !== "sma" && t.chart[k].name}
                </p>
                <Explain>{t.chart[k].text}</Explain>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
