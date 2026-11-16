// Turns raw numbers into simple traffic-light verdicts.
// Text lives in the i18n dictionaries; this file only returns keys.
import type { Candle } from "./types";
import { last, macd, rsi, sma } from "./indicators";

export type Level = "good" | "ok" | "bad" | "neutral";

export type SignalKey =
  | "rsiOverbought" | "rsiOversold" | "rsiNeutral"
  | "aboveSma200" | "belowSma200"
  | "goldenCross" | "deathCross" // a crossing event in the last CROSS_LOOKBACK sessions
  | "sma50Above200" | "sma50Below200" // the trend state when there was no recent crossing
  | "macdBull" | "macdBear";

export interface Signal {
  key: SignalKey;
  level: Level;
  value?: number;
  date?: string; // when the event happened (YYYY-MM-DD)
  days?: number; // sessions since the event
  close?: number; // last close the signal was computed on
  asOf?: string; // date of that close
}

export const CROSS_LOOKBACK = 30;

/**
 * Most recent crossing of the 50-day average over (golden) or under (death) the 200-day
 * average within the last `lookback` sessions. A golden cross is the crossing itself,
 * not the state "50 above 200", which can last for years.
 */
export function recentCross(
  history: Candle[],
  lookback = CROSS_LOOKBACK,
): { kind: "golden" | "death"; index: number } | null {
  const closes = history.map((c) => c.close);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  for (let i = closes.length - 1; i >= Math.max(1, closes.length - lookback); i--) {
    const [a0, b0, a1, b1] = [s50[i - 1], s200[i - 1], s50[i], s200[i]];
    if (a0 == null || b0 == null || a1 == null || b1 == null) break;
    if (a0 <= b0 && a1 > b1) return { kind: "golden", index: i };
    if (a0 >= b0 && a1 < b1) return { kind: "death", index: i };
  }
  return null;
}

export function technicalSignals(history: Candle[]): Signal[] {
  const closes = history.map((c) => c.close);
  const out: Signal[] = [];
  const r = last(rsi(closes));
  if (r != null) {
    out.push(r >= 70 ? { key: "rsiOverbought", level: "bad", value: r }
      : r <= 30 ? { key: "rsiOversold", level: "good", value: r }
      : { key: "rsiNeutral", level: "neutral", value: r });
  }
  const s200 = last(sma(closes, 200));
  const s50 = last(sma(closes, 50));
  const price = closes[closes.length - 1];
  if (s200 != null) {
    const asOf = history[history.length - 1].time;
    out.push(price >= s200 ? { key: "aboveSma200", level: "good", value: s200, close: price, asOf } : { key: "belowSma200", level: "bad", value: s200, close: price, asOf });
  }
  if (s50 != null && s200 != null) {
    const cross = recentCross(history);
    if (cross) {
      const golden = cross.kind === "golden";
      out.push({
        key: golden ? "goldenCross" : "deathCross",
        level: golden ? "good" : "bad",
        date: history[cross.index].time,
        days: history.length - 1 - cross.index,
      });
    } else {
      out.push(s50 >= s200 ? { key: "sma50Above200", level: "good" } : { key: "sma50Below200", level: "bad" });
    }
  }
  const h = last(macd(closes).hist);
  if (h != null) out.push(h >= 0 ? { key: "macdBull", level: "good" } : { key: "macdBear", level: "bad" });
  return out;
}
