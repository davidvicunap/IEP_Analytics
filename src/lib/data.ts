// Server-side data facade: real FMP data, or simulated data in development only.
import { getDb } from "@/db/client";
import * as fmp from "./fmp";
import { searchSecurities } from "./securities";
import * as mock from "./mock";
import type { DataSource, Quote, QuoteEntry, Result, SearchResult, StockBundle } from "./types";

/**
 * Simulated prices must never reach real users: demo data is only allowed outside
 * production, or when DEMO_MODE=1 is set explicitly (e.g. a local production build).
 */
export function demoAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" || env.DEMO_MODE === "1";
}

export const isDemo = (): boolean => !fmp.hasFmpKey() && demoAllowed();

export const dataSource = (): DataSource => (isDemo() ? "DEMO" : "FMP");

const now = () => new Date().toISOString();

function demo<T>(value: T | null): Result<T> {
  return value == null ? { ok: false, error: "not_found" } : { ok: true, data: value, fetchedAt: now() };
}

// ---- Local measurement knobs (no effect unless set) -------------------------------------
// IEP_TRACE=1 logs every facade call, so provider calls per user journey can be counted.
// DEMO_LATENCY_MS adds simulated provider latency to demo data only (never to real data),
// so loading behaviour can be measured locally without spending provider quota.
export type CallKind = "quote" | "profile" | "fundamentals" | "income" | "history" | "search";
const LATENCY_WEIGHT: Record<CallKind, number> = { quote: 1, profile: 1, fundamentals: 1.5, income: 1.5, history: 2, search: 0.5 };

function trace(kind: CallKind, symbol: string) {
  if (process.env.IEP_TRACE === "1") console.log(JSON.stringify({ event: "facade_call", kind, symbol, demo: isDemo() }));
}

async function demoDelay(kind: CallKind) {
  const ms = Number(process.env.DEMO_LATENCY_MS ?? 0) * LATENCY_WEIGHT[kind];
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

async function demoResult<T>(kind: CallKind, value: T | null): Promise<Result<T>> {
  await demoDelay(kind);
  return demo(value);
}

export function normalizeSymbol(raw: string): string | null {
  const s = decodeURIComponent(raw).trim().toUpperCase();
  return /^[A-Z][A-Z.\-]{0,9}$/.test(s) ? s : null;
}

export function getQuote(symbol: string): Promise<Result<Quote>> {
  trace("quote", symbol);
  return isDemo() ? demoResult("quote", mock.mockQuote(symbol)) : fmp.fmpQuote(symbol);
}

/** Quotes in request order; a symbol that fails keeps its place with the reason. */
export async function getQuotes(symbols: string[]): Promise<QuoteEntry[]> {
  const list = [...new Set(symbols.map(normalizeSymbol).filter((s): s is string => !!s))].slice(0, 30);
  const results = await Promise.all(list.map(getQuote));
  return list.map((symbol, i) => {
    const r = results[i];
    return r.ok ? { symbol, quote: r.data, fetchedAt: r.fetchedAt } : { symbol, error: r.error };
  });
}

export type StockDetails = Omit<StockBundle, "quote" | "quoteFetchedAt">;

/** Everything on the stock page except the quote, which the page loads first. */
export async function getStockDetails(symbol: string): Promise<StockDetails> {
  for (const k of ["profile", "fundamentals", "income", "history"] as const) trace(k, symbol);
  if (isDemo()) {
    const [profile, fundamentals, income, history] = await Promise.all([
      demoResult("profile", mock.mockProfile(symbol)),
      demoResult("fundamentals", mock.mockFundamentals(symbol)),
      demoResult("income", mock.mockIncome(symbol)),
      demoResult("history", mock.mockHistory(symbol)),
    ]);
    return { source: "DEMO", profile, fundamentals, income, history };
  }
  // News comes from TradingView and SEC 8-K filings in the browser, not from FMP's quota.
  const [profile, fundamentals, income, history] = await Promise.all([
    fmp.fmpProfile(symbol),
    fmp.fmpFundamentals(symbol),
    fmp.fmpIncome(symbol),
    fmp.fmpHistory(symbol),
  ]);
  return { source: "FMP", profile, fundamentals, income, history };
}

export async function searchSymbols(query: string): Promise<Result<SearchResult[]>> {
  const q = query.trim().slice(0, 40);
  if (!q) return { ok: true, data: [], fetchedAt: now() };
  trace("search", q);
  if (isDemo()) return demoResult("search", mock.mockSearch(q));

  // Local search over the SEC securities list: instant and uses no FMP quota.
  // FMP is the fallback when the database is missing, failing or has no match.
  const db = getDb();
  if (db) {
    try {
      const data = await searchSecurities(db, q);
      if (data.length > 0) return { ok: true, data, fetchedAt: now() };
    } catch (e) {
      console.error(JSON.stringify({ event: "db_search_error", message: e instanceof Error ? e.message : String(e) }));
    }
  }
  return fmp.fmpSearch(q);
}
