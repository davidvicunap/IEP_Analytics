// Price chart settings: shared by the chart, the page URL and the placeholder that reserves
// the chart's space while its code loads. Tiny on purpose: it ships with the page.
export type Range = "1M" | "6M" | "1Y" | "5Y";
export type ChartStyle = "candles" | "line";
export type Ind = "sma" | "bb" | "rsi" | "macd" | "volume";

export interface ChartSettings {
  range: Range;
  style: ChartStyle;
  inds: Ind[];
}

export const RANGES: Range[] = ["1M", "6M", "1Y", "5Y"];
export const INDICATORS: Ind[] = ["sma", "bb", "rsi", "macd", "volume"];
export const RANGE_SESSIONS: Record<Range, number> = { "1M": 22, "6M": 126, "1Y": 252, "5Y": 1260 };
export const DEFAULT_CHART: ChartSettings = { range: "1Y", style: "candles", inds: ["sma", "volume"] };

/** Indicators drawn in their own pane under the price. */
export const PANE_INDS: Ind[] = ["rsi", "macd"];

/** Main pane height in CSS (the same for the chart and its placeholder), plus 110 px per extra pane. */
export function chartHeight(inds: Ind[]): string {
  const panes = inds.filter((i) => PANE_INDS.includes(i)).length;
  return `calc(clamp(280px, 45vh, 440px) + ${panes * 110}px)`;
}

export function parseChartSettings(p: URLSearchParams): ChartSettings {
  const range = p.get("range") as Range | null;
  const style = p.get("style") as ChartStyle | null;
  const ind = p.get("ind");
  return {
    range: range && RANGES.includes(range) ? range : DEFAULT_CHART.range,
    style: style === "line" || style === "candles" ? style : DEFAULT_CHART.style,
    inds: ind === null ? DEFAULT_CHART.inds : INDICATORS.filter((i) => ind.split(",").includes(i)),
  };
}

/** Writes only what differs from the defaults, so plain links stay clean. */
export function writeChartSettings(p: URLSearchParams, s: ChartSettings): URLSearchParams {
  const out = new URLSearchParams(p);
  const set = (k: string, v: string, def: string) => (v === def ? out.delete(k) : out.set(k, v));
  set("range", s.range, DEFAULT_CHART.range);
  set("style", s.style, DEFAULT_CHART.style);
  const ordered = INDICATORS.filter((i) => s.inds.includes(i)).join(",");
  set("ind", ordered, DEFAULT_CHART.inds.join(","));
  return out;
}

/** The visible window for a range over `n` sessions, as logical bar indexes. */
export function visibleWindow(n: number, range: Range): { from: number; to: number } {
  const span = Math.min(n, RANGE_SESSIONS[range]);
  return { from: Math.max(0, n - span) - 0.5, to: n - 0.5 };
}
