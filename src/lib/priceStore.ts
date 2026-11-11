// The last good quote per symbol, kept in Postgres so a price can still be shown (labelled
// with its time) when FMP can't answer. Also builds a quote from the last daily close.
import { inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { priceSnapshots } from "@/db/schema";
import type { Candle, Quote } from "./types";

export interface StoredQuote {
  quote: Quote;
  fetchedAt: string;
}

/** Saves a live quote; an older one never replaces a newer one. */
export async function saveQuote(db: Db, quote: Quote, fetchedAt: string): Promise<void> {
  const { basis: _ignored, ...live } = quote;
  await db
    .insert(priceSnapshots)
    .values({ symbol: quote.symbol, quote: live, fetchedAt: new Date(fetchedAt) })
    .onConflictDoUpdate({
      target: priceSnapshots.symbol,
      set: { quote: sql`excluded.quote`, fetchedAt: sql`excluded.fetched_at` },
      setWhere: sql`${priceSnapshots.fetchedAt} < excluded.fetched_at`,
    });
}

/** Stored quotes for `symbols`, marked as stored. Missing symbols are simply absent. */
export async function storedQuotes(db: Db, symbols: string[]): Promise<Map<string, StoredQuote>> {
  const out = new Map<string, StoredQuote>();
  if (symbols.length === 0) return out;
  const rows = await db.select().from(priceSnapshots).where(inArray(priceSnapshots.symbol, symbols));
  for (const r of rows) out.set(r.symbol, { quote: { ...(r.quote as Quote), basis: "stored" }, fetchedAt: r.fetchedAt.toISOString() });
  return out;
}

/**
 * A quote from daily closes: price = last close, change against the close before, the day's
 * range from the last candle and the 52-week range from the last year of closes.
 */
export function quoteFromCloses(symbol: string, name: string, candles: Candle[]): Quote | null {
  const last = candles.at(-1);
  if (!last || !(last.close > 0)) return null;
  const prev = candles.at(-2)?.close;
  const yearAgo = Date.parse(last.time) - 365 * 86_400_000;
  const year = candles.filter((c) => Date.parse(c.time) >= yearAgo).map((c) => c.close);
  const change = prev ? last.close - prev : 0;
  return {
    symbol,
    name,
    price: last.close,
    change,
    changePercent: prev ? (change / prev) * 100 : 0,
    open: last.open,
    dayLow: last.low,
    dayHigh: last.high,
    previousClose: prev,
    volume: last.volume,
    yearLow: Math.min(...year),
    yearHigh: Math.max(...year),
    asOf: `${last.time}T12:00:00.000Z`, // a day, not a time: midday UTC keeps the date right in every US zone
    basis: "close",
  };
}
