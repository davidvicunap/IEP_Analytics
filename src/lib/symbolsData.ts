// Server-side: for the tickers a user holds or follows, whether each still trades (or under which
// new ticker) and the splits detected for it. Listings come from the SEC company list (no quota).
// Demo mode without a database reads DEMO_LISTINGS ("FB:META,XYZ:") and DEMO_SPLITS for checks.
import { inArray, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { securities } from "@/db/schema";
import { isDemo } from "./data";
import { listingOf, type Listing, type SecurityRow } from "./listings";
import type { Split } from "./splits";
import { demoSplitSeed, memorySplits, postgresSplits, type SplitStore } from "./splitStore";

export interface SymbolInfo {
  symbol: string;
  listing: Listing;
  splits: Split[];
}

let demo: SplitStore | null = null;
export function splitStore(): SplitStore | null {
  const db = getDb();
  if (db) return postgresSplits(db);
  if (isDemo()) return (demo ??= memorySplits(demoSplitSeed()));
  return null;
}

function demoListings(symbols: string[]): Map<string, Listing> {
  const map = new Map<string, Listing>();
  for (const part of (process.env.DEMO_LISTINGS ?? "").split(",")) {
    const [from, to] = part.split(":").map((x) => x?.trim());
    if (!from || !symbols.includes(from)) continue;
    map.set(from, to ? { status: "renamed", to } : { status: "delisted" });
  }
  for (const s of symbols) if (!map.has(s)) map.set(s, { status: "active" });
  return map;
}

export async function listings(symbols: string[]): Promise<Map<string, Listing>> {
  const db = getDb();
  if (!db) return isDemo() ? demoListings(symbols) : new Map(symbols.map((s) => [s, { status: "unknown" } as Listing]));
  const mine = await db.select({ symbol: securities.symbol, cik: securities.cik, active: securities.active, rank: securities.rank }).from(securities).where(inArray(securities.symbol, symbols));
  const ciks = [...new Set(mine.map((r) => r.cik))];
  const rows: SecurityRow[] = ciks.length ? await db.select({ symbol: securities.symbol, cik: securities.cik, active: securities.active, rank: securities.rank }).from(securities).where(or(inArray(securities.cik, ciks), inArray(securities.symbol, symbols))) : mine;
  return new Map(symbols.map((s) => [s, listingOf(s, rows)]));
}

/**
 * The same, keyed by ticker, for the checks: a failure gives an empty map (the checks then run
 * as before, without split or listing news) and is logged.
 */
export async function symbolInfoMap(symbols: string[]): Promise<Map<string, SymbolInfo>> {
  if (!symbols.length) return new Map();
  try {
    return new Map((await getSymbolInfo([...new Set(symbols)])).map((i) => [i.symbol, i]));
  } catch (e) {
    console.error(JSON.stringify({ event: "symbols_info_error", message: e instanceof Error ? e.message : String(e) }));
    return new Map();
  }
}

export async function getSymbolInfo(symbols: string[]): Promise<SymbolInfo[]> {
  const [l, sp] = await Promise.all([listings(symbols), splitStore()?.list(symbols) ?? Promise.resolve([])]);
  return symbols.map((symbol) => ({ symbol, listing: l.get(symbol) ?? { status: "unknown" }, splits: sp.filter((x) => x.symbol === symbol) }));
}
