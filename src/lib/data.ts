// Server-side data facade: real FMP data, or simulated data in development only.
import * as fmp from "./fmp";
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

export function normalizeSymbol(raw: string): string | null {
  const s = decodeURIComponent(raw).trim().toUpperCase();
  return /^[A-Z][A-Z.\-]{0,9}$/.test(s) ? s : null;
}

export function getQuote(symbol: string): Promise<Result<Quote>> {
  return isDemo() ? Promise.resolve(demo(mock.mockQuote(symbol))) : fmp.fmpQuote(symbol);
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
  if (isDemo()) {
    return {
      source: "DEMO",
      profile: demo(mock.mockProfile(symbol)),
      fundamentals: demo(mock.mockFundamentals(symbol)),
      income: demo(mock.mockIncome(symbol)),
      history: demo(mock.mockHistory(symbol)),
      news: demo(mock.mockNews(symbol)),
    };
  }
  const [profile, fundamentals, income, history, news] = await Promise.all([
    fmp.fmpProfile(symbol),
    fmp.fmpFundamentals(symbol),
    fmp.fmpIncome(symbol),
    fmp.fmpHistory(symbol),
    fmp.fmpNews(symbol),
  ]);
  return { source: "FMP", profile, fundamentals, income, history, news };
}

export async function searchSymbols(query: string): Promise<Result<SearchResult[]>> {
  const q = query.trim().slice(0, 40);
  if (!q) return { ok: true, data: [], fetchedAt: now() };
  return isDemo() ? demo(mock.mockSearch(q)) : fmp.fmpSearch(q);
}
