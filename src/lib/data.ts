// Server-side data facade: real FMP data, or simulated data in development only.
import { getDb } from "@/db/client";
import * as fmp from "./fmp";
import { quoteFromCloses, saveQuote, storedQuotes } from "./priceStore";
import { getSecurity, searchSecurities } from "./securities";
import * as mock from "./mock";
import type { AnnualIncome, Candle, DataIssue, DataSource, Fundamentals, Profile, Quote, QuoteEntry, Result, SearchResult } from "./types";

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

// DEMO_SLOW_SYMBOLS=IWM and DEMO_SLOW_MS=1500 make those symbols' quotes slow (provider tail latency).
async function demoDelay(kind: CallKind, symbol?: string) {
  let ms = Number(process.env.DEMO_LATENCY_MS ?? 0) * LATENCY_WEIGHT[kind];
  if (kind === "quote" && symbol && (process.env.DEMO_SLOW_SYMBOLS ?? "").split(",").includes(symbol)) ms += Number(process.env.DEMO_SLOW_MS ?? 0);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

async function demoResult<T>(kind: CallKind, value: T | null, symbol?: string): Promise<Result<T>> {
  await demoDelay(kind, symbol);
  return demo(value);
}

export function normalizeSymbol(raw: string): string | null {
  const s = decodeURIComponent(raw).trim().toUpperCase();
  return /^[A-Z][A-Z.\-]{0,9}$/.test(s) ? s : null;
}

export async function getQuote(symbol: string): Promise<Result<Quote>> {
  trace("quote", symbol);
  if (isDemo()) return demoResult("quote", mock.mockQuote(symbol), symbol);
  const r = await fmp.fmpQuote(symbol);
  if (r.ok) await keepQuote(r.data, r.fetchedAt);
  return r;
}

// ---- Last good prices ------------------------------------------------------------------
// Every live quote is kept in Postgres (once per fetch, not per page view), so lists and
// stock pages can still show a price, labelled with its time, when FMP can't answer.
const kept = new Map<string, string>(); // symbol -> fetchedAt already saved by this instance

async function keepQuote(quote: Quote, fetchedAt: string): Promise<void> {
  const db = getDb();
  if (!db || kept.get(quote.symbol) === fetchedAt) return;
  kept.set(quote.symbol, fetchedAt);
  try {
    await saveQuote(db, quote, fetchedAt);
  } catch (e) {
    kept.delete(quote.symbol);
    console.error(JSON.stringify({ event: "price_store_error", message: e instanceof Error ? e.message : String(e) }));
  }
}

async function readStored(symbols: string[]): Promise<Map<string, { quote: Quote; fetchedAt: string }>> {
  const db = getDb();
  if (!db || symbols.length === 0) return new Map();
  try {
    return await storedQuotes(db, symbols);
  } catch (e) {
    console.error(JSON.stringify({ event: "price_store_error", message: e instanceof Error ? e.message : String(e) }));
    return new Map();
  }
}

// DEMO_PRICE_FALLBACK="HIMS:none,SMCI:close,AMD:stored" makes those demo symbols behave as
// if FMP refused their quote (not in the plan), to check the fallbacks in a browser.
function demoFallback(symbol: string): StockPage | null {
  const mode = (process.env.DEMO_PRICE_FALLBACK ?? "")
    .split(",")
    .map((x) => x.split(":"))
    .find(([s]) => s === symbol)?.[1];
  const q = mode ? mock.mockQuote(symbol) : null;
  if (!q) return null;
  const identity = { symbol, name: q.name, exchange: q.exchange };
  const at = now();
  if (mode === "none") return { kind: "ok", identity, quote: null, fetchedAt: null, priceIssue: "plan_restricted" };
  if (mode === "close") return { kind: "ok", identity, quote: { ...q, basis: "close", asOf: `${at.slice(0, 10)}T12:00:00.000Z` }, fetchedAt: at, priceIssue: "plan_restricted" };
  return { kind: "ok", identity, quote: { ...q, basis: "stored" }, fetchedAt: at, priceIssue: "rate_limited" };
}

/** Who the stock page is about, even without a price. */
export interface StockIdentity {
  symbol: string;
  name: string;
  exchange?: string;
}

export type StockPage =
  | { kind: "ok"; identity: StockIdentity; quote: Quote | null; fetchedAt: string | null; priceIssue: DataIssue | null }
  | { kind: "not_found" }
  | { kind: "unavailable"; issue: DataIssue };

/**
 * What the stock page opens with. The price comes from the first source that answers:
 * 1. FMP's live quote;
 * 2. the last quote we stored;
 * 3. the last daily close (the page loads the same price history anyway);
 * 4. none: the page still opens from the SEC company list, and says why there's no price.
 * Only a symbol that neither FMP nor the SEC list knows is "not found".
 */
export async function getStockPage(symbol: string): Promise<StockPage> {
  if (isDemo()) {
    const demoPage = demoFallback(symbol);
    if (demoPage) return demoPage;
  }
  const live = await getQuote(symbol);
  if (live.ok) {
    const q = live.data;
    return { kind: "ok", identity: { symbol, name: q.name, exchange: q.exchange }, quote: q, fetchedAt: live.fetchedAt, priceIssue: null };
  }
  const db = isDemo() ? null : getDb();
  const [security, stored] = await Promise.all([
    db ? getSecurity(db, symbol).catch(() => null) : null,
    readStored([symbol]).then((m) => m.get(symbol)),
  ]);
  if (!security && !stored) return live.error === "not_found" ? { kind: "not_found" } : { kind: "unavailable", issue: live.error };
  const identity: StockIdentity = {
    symbol,
    name: stored?.quote.name ?? security!.name,
    exchange: stored?.quote.exchange ?? security?.exchange ?? undefined,
  };
  if (stored) return { kind: "ok", identity, quote: stored.quote, fetchedAt: stored.fetchedAt, priceIssue: live.error };
  const history = await fmp.fmpHistory(symbol);
  const fromClose = history.ok ? quoteFromCloses(symbol, identity.name, history.data) : null;
  return { kind: "ok", identity, quote: fromClose, fetchedAt: fromClose && history.ok ? history.fetchedAt : null, priceIssue: live.error };
}

/** Most symbols one quotes request may ask for; callers page through longer lists. */
export const QUOTES_PER_REQUEST = 30;
const QUOTE_CONCURRENCY = 10; // one round for the home sections and typical lists; bounded for 30

/** Runs `fn` over `items` with at most `limit` calls in flight, keeping the order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Quotes in request order; a symbol that fails keeps its place with the reason. At most
 * QUOTES_PER_REQUEST symbols: the rest are returned in `skipped` instead of being dropped
 * silently, so the client can ask for them in another request.
 */
export async function getQuotes(symbols: string[]): Promise<QuoteEntry[] & { skipped?: string[] }> {
  const all = [...new Set(symbols.map(normalizeSymbol).filter((s): s is string => !!s))];
  const list = all.slice(0, QUOTES_PER_REQUEST);
  const results = await mapLimit(list, QUOTE_CONCURRENCY, getQuote);
  // A symbol FMP can't answer now shows its last stored price, marked as such.
  const stored = await readStored(list.filter((_, i) => !results[i].ok));
  const entries: QuoteEntry[] & { skipped?: string[] } = list.map((symbol, i) => {
    const r = results[i];
    if (r.ok) return { symbol, quote: r.data, fetchedAt: r.fetchedAt };
    const s = stored.get(symbol);
    return s ? { symbol, quote: s.quote, fetchedAt: s.fetchedAt, error: r.error } : { symbol, error: r.error };
  });
  if (all.length > list.length) entries.skipped = all.slice(list.length);
  return entries;
}

export interface StockSections {
  source: DataSource;
  profile: Promise<Result<Profile>>;
  fundamentals: Promise<Result<Fundamentals>>;
  income: Promise<Result<AnnualIncome[]>>; // oldest -> newest
  history: Promise<Result<Candle[]>>; // oldest -> newest
}

/**
 * Everything on the stock page except the quote, started in parallel and NOT awaited:
 * each section of the page waits only for its own data. The promises never reject; a
 * failure resolves to a typed Result.
 */
export function getStockSections(symbol: string): StockSections {
  for (const k of ["profile", "fundamentals", "income", "history"] as const) trace(k, symbol);
  if (isDemo()) {
    return {
      source: "DEMO",
      profile: demoResult("profile", mock.mockProfile(symbol)),
      fundamentals: demoResult("fundamentals", mock.mockFundamentals(symbol)),
      income: demoResult("income", mock.mockIncome(symbol)),
      history: demoResult("history", mock.mockHistory(symbol)),
    };
  }
  // News comes from TradingView and SEC 8-K filings in the browser, not from FMP's quota.
  return {
    source: "FMP",
    profile: fmp.fmpProfile(symbol),
    fundamentals: fmp.fmpFundamentals(symbol),
    income: fmp.fmpIncome(symbol),
    history: fmp.fmpHistory(symbol),
  };
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
