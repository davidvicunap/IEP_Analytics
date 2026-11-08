// Chart generator state <-> URL (?s=AAPL,MSFT&m=revenue&f=annual&t=growth&k=bar&r=10), so any
// chart can be shared or bookmarked. Pure: used by the page and by tests.
import { MAX_METRICS, METRIC_KEYS, MAX_SYMBOLS, RANGES, compatible, metricDef, type ChartMetric, type Freq, type Transform } from "./chartMetrics";

const SYMBOL = /^[A-Z][A-Z.\-]{0,9}$/;

export type ChartKind = "line" | "bar";
export interface ChartConfig {
  symbols: string[];
  metrics: ChartMetric[];
  freq: Freq;
  transform: Transform;
  kind: ChartKind;
  range: number;
}

export const DEFAULT_CONFIG: ChartConfig = { symbols: ["AAPL", "MSFT"], metrics: ["revenue"], freq: "annual", transform: "values", kind: "bar", range: 10 };

/** Reads the chart from the URL; anything invalid falls back to a sensible default. */
export function parseConfig(p: URLSearchParams): ChartConfig {
  if (![...p.keys()].length) return DEFAULT_CONFIG;
  const symbols = [...new Set((p.get("s") ?? "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => SYMBOL.test(x)))].slice(0, MAX_SYMBOLS);
  const freq = (["annual", "quarterly", "monthly"] as Freq[]).includes(p.get("f") as Freq) ? (p.get("f") as Freq) : "annual";
  let metrics = [...new Set((p.get("m") ?? "").split(",").filter((x): x is ChartMetric => METRIC_KEYS.has(x as ChartMetric)))]
    .filter((m) => metricDef(m).freqs.includes(freq))
    .slice(0, MAX_METRICS);
  if (!metrics.length) metrics = [freq === "monthly" ? "pe" : "revenue"];
  const transform = (["values", "growth", "index"] as Transform[]).includes(p.get("t") as Transform) ? (p.get("t") as Transform) : "values";
  if (!compatible(metrics, transform)) metrics = metrics.filter((m) => metricDef(m).unit === metricDef(metrics[0]).unit);
  const kind: ChartKind = p.get("k") === "line" ? "line" : p.get("k") === "bar" ? "bar" : freq === "annual" ? "bar" : "line";
  const r = Number(p.get("r"));
  const range = RANGES[freq].includes(r) ? r : RANGES[freq][1];
  return { symbols, metrics, freq, transform, kind, range };
}

export function writeConfig(c: ChartConfig): string {
  const p = new URLSearchParams();
  p.set("s", c.symbols.join(","));
  p.set("m", c.metrics.join(","));
  p.set("f", c.freq);
  if (c.transform !== "values") p.set("t", c.transform);
  p.set("k", c.kind);
  p.set("r", String(c.range));
  return p.toString().replace(/%2C/g, ",");
}
