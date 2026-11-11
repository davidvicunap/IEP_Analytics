// Numbers shown next to a chart: the peer median line and a growth readout per series. Pure.
import type { Freq, Unit } from "./chartMetrics";

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Median of the peers per period, only where at least `min` peers have a value, so a lone
 * company never passes for "the industry". `counts` says how many were used each period.
 */
export function peerMedian(series: (number | null)[][], min = 3): { values: (number | null)[]; counts: number[] } {
  const n = Math.max(0, ...series.map((s) => s.length));
  const values: (number | null)[] = [];
  const counts: number[] = [];
  for (let i = 0; i < n; i++) {
    const xs = series.map((s) => s[i]).filter((v): v is number => v != null && Number.isFinite(v));
    counts.push(xs.length);
    values.push(xs.length >= min ? median(xs) : null);
  }
  return { values, counts };
}

const PER_YEAR: Record<Freq, number> = { annual: 1, quarterly: 4, monthly: 12 };

export type Readout =
  | { kind: "cagr"; rate: number; years: number; from: number; to: number } // amounts: yearly growth rate
  | { kind: "points"; change: number; from: number; to: number } // percentages: change in points
  | { kind: "change"; from: number; to: number } // multiples: from → to
  | { kind: "median"; value: number; n: number }; // growth charts: median yearly growth

/**
 * One line under a chart for a series, between its first and last value in the window. A
 * growth rate needs two positive amounts (from or into a loss it means nothing, so none is
 * given); quarters are compared with the same quarter, so seasons don't distort it.
 */
export function readout(values: (number | null)[], unit: Unit | "index", freq: Freq, transform: "values" | "growth" | "index"): Readout | null {
  const idx = values.map((v, i) => (v != null && Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
  if (transform === "growth") {
    const xs = idx.map((i) => values[i]!);
    const m = median(xs);
    return m === null || xs.length < 2 ? null : { kind: "median", value: m, n: xs.length };
  }
  if (idx.length < 2) return null;
  const last = idx[idx.length - 1];
  const step = PER_YEAR[freq];
  const amount = unit !== "pct" && unit !== "multiple";
  // First point a whole number of years before the last one (for amounts, the first positive
  // one: the readout says how many years it covers).
  const first = idx.find((i) => (last - i) % step === 0 && last - i >= step && (!amount || values[i]! > 0));
  if (first === undefined) return null;
  const from = values[first]!;
  const to = values[last]!;
  if (unit === "pct") return { kind: "points", change: to - from, from, to };
  if (unit === "multiple") return { kind: "change", from, to };
  const years = (last - first) / step;
  if (!(from > 0) || !(to > 0)) return null;
  return { kind: "cagr", rate: (to / from) ** (1 / years) - 1, years, from, to };
}
