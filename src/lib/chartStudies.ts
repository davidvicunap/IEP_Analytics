// The indicators a TradingView chart opens with, saved to your account. The embedded chart
// can't tell us what you add inside it (it runs on TradingView's site), so the choice is made
// here and passed in as the widget's `studies`. Drawings can't be kept this way.
export const CHART_STUDIES = ["sma", "ema", "bb", "vwap", "rsi", "macd", "stochrsi", "atr", "obv"] as const;
export type ChartStudy = (typeof CHART_STUDIES)[number];

/** TradingView's ids for the embedded Advanced Chart widget. */
export const TV_STUDY: Record<ChartStudy, string> = {
  sma: "MASimple@tv-basicstudies",
  ema: "MAExp@tv-basicstudies",
  bb: "BB@tv-basicstudies",
  vwap: "VWAP@tv-basicstudies",
  rsi: "RSI@tv-basicstudies",
  macd: "MACD@tv-basicstudies",
  stochrsi: "StochasticRSI@tv-basicstudies",
  atr: "ATR@tv-basicstudies",
  obv: "OBV@tv-basicstudies",
};

/** More than this crowds the chart (each oscillator takes its own pane). */
export const MAX_STUDIES = 5;

/** Known indicators only, each once, in the catalog's order, at most MAX_STUDIES. */
export function parseStudies(raw: unknown): ChartStudy[] {
  if (!Array.isArray(raw)) return [];
  const picked = new Set(raw.filter((x): x is ChartStudy => typeof x === "string" && (CHART_STUDIES as readonly string[]).includes(x)));
  return CHART_STUDIES.filter((s) => picked.has(s)).slice(0, MAX_STUDIES);
}

/** Turns one on or off; turning on past the limit changes nothing. */
export function toggleStudy(list: ChartStudy[], s: ChartStudy): ChartStudy[] {
  if (list.includes(s)) return list.filter((x) => x !== s);
  return list.length >= MAX_STUDIES ? list : parseStudies([...list, s]);
}

export const widgetStudies = (list: ChartStudy[]) => list.map((s) => TV_STUDY[s]);
