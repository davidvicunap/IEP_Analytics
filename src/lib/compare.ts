// The compare page: which companies (from the URL) and which row values stand out. Pure.
import type { RatioKey } from "./ratios";
import { TICKER } from "./search";
import type { MultipleKey } from "./valuation";

export const MAX_COMPARE = 4;

/** Rows of the ratios table: growth, margins, returns, debt (each against the company's industry). */
export const COMPARE_RATIOS: RatioKey[] = ["revenueGrowth", "epsGrowth", "grossMargin", "operatingMargin", "netMargin", "fcfMargin", "roic", "roe", "debtToEquity"];
/** Rows of the valuation table: today's multiple against the company's own 5-year average. */
export const COMPARE_MULTIPLES: MultipleKey[] = ["pe", "evEbitda", "ps", "pb", "fcfYield"];

/** "aapl,MSFT msft-googl" → ["AAPL", "MSFT", "GOOGL"]: valid tickers, no repeats, at most four. */
export function parseCompare(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? "").toUpperCase().split(/[\s,+]+/)) {
    const s = part.trim();
    if (s && TICKER.test(s) && !out.includes(s) && out.length < MAX_COMPARE) out.push(s);
  }
  return out;
}

export const compareHref = (symbols: string[]) => (symbols.length ? `/compare?s=${symbols.map(encodeURIComponent).join(",")}` : "/compare");

/** The column whose value is best in its row, when at least two have one and it isn't a tie. */
export function bestIndex(values: (number | null | undefined)[], better: "higher" | "lower"): number | null {
  const known = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => typeof x.v === "number" && Number.isFinite(x.v));
  if (known.length < 2) return null;
  const sorted = [...known].sort((a, b) => (better === "higher" ? b.v - a.v : a.v - b.v));
  return sorted[0].v === sorted[1].v ? null : sorted[0].i;
}
