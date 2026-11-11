// Server-only client for Financial Modeling Prep's "stable" API.
// - The API key is read from process.env; it never reaches the browser, cache keys or logs.
// - Every call returns a typed Result, so the UI can say exactly why data is missing.
// - Only successful responses are cached: errors throw inside the cached function,
//   so a transient 429 or plan error is retried on the next request instead of sticking.
import { unstable_cache } from "next/cache";
import { REMEMBER, currentQuoteTtl, isPaused, pause, rememberIssue, rememberKey, rememberedIssue } from "./fmpGuard";
import { recordProviderCall } from "./quota";
import type {
  AnnualIncome,
  Candle,
  DataIssue,
  Fundamentals,
  Profile,
  Quote,
  Result,
  SearchResult,
} from "./types";

const BASE = "https://financialmodelingprep.com/stable";
const TIMEOUT_MS = 8000;

/** Cache lifetimes in seconds per data class. Quotes vary with market hours and quota use (fmpGuard). */
export const TTL = { prices: 3600, rates: 43200, fundamentals: 86400 } as const;

export function hasFmpKey(): boolean {
  return Boolean(process.env.FMP_API_KEY);
}

export class ProviderError extends Error {
  constructor(
    readonly kind: DataIssue,
    readonly status?: number,
  ) {
    super(`fmp:${kind}`);
    this.name = "ProviderError";
  }
}

function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError || (e instanceof Error && e.name === "ProviderError" && "kind" in e);
}

/** Maps FMP's error text (it sometimes answers HTTP 200 with an error object). */
export function kindFromMessage(message: string): DataIssue {
  const m = message.toLowerCase();
  if (/limit reach|rate limit|too many requests/.test(m)) return "rate_limited";
  if (/subscription|premium|exclusive|restricted|upgrade|not available under|plan/.test(m)) return "plan_restricted";
  if (/api ?key|unauthori[sz]ed|invalid key/.test(m)) return "unauthorized";
  return "upstream";
}

export function kindFromStatus(status: number, body: string): DataIssue {
  if (status === 401) return "unauthorized";
  if (status === 402) return "plan_restricted";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 403) {
    const kind = kindFromMessage(body);
    return kind === "upstream" ? "unauthorized" : kind;
  }
  return "upstream";
}

type Json = Record<string, unknown>;
export interface Fetched {
  rows: Json[];
  fetchedAt: string;
}

function logged(err: ProviderError, endpoint: string): ProviderError {
  // The request URL is never logged: it carries the API key.
  console.error(
    JSON.stringify({ event: "provider_error", provider: "fmp", endpoint, kind: err.kind, status: err.status ?? null }),
  );
  return err;
}

/** One uncached request to FMP. Throws ProviderError on any failure. */
export async function fetchFmp(path: string, params: Record<string, string>): Promise<Fetched> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw logged(new ProviderError("not_configured"), path);
  const qs = new URLSearchParams({ ...params, apikey: key });
  await recordProviderCall("fmp"); // counts real upstream calls only (cache hits never get here)

  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}?${qs}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw logged(new ProviderError("upstream"), path);
  }

  const text = await res.text();
  if (!res.ok) throw logged(new ProviderError(kindFromStatus(res.status, text), res.status), path);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw logged(new ProviderError("upstream", res.status), path);
  }

  const fetchedAt = new Date().toISOString();
  if (Array.isArray(body)) return { rows: body as Json[], fetchedAt };
  if (body && typeof body === "object") {
    const obj = body as Json;
    if (Array.isArray(obj.historical)) return { rows: obj.historical as Json[], fetchedAt };
    const message = obj["Error Message"] ?? obj.error ?? obj.message;
    if (typeof message === "string") throw logged(new ProviderError(kindFromMessage(message), res.status), path);
  }
  throw logged(new ProviderError("upstream", res.status), path);
}

/** A cached answer: data, or an issue that won't change soon (see fmpGuard.REMEMBER). */
type CachedAnswer = Fetched & { known?: DataIssue };

const cachedByTtl = new Map<number, (path: string, params: string) => Promise<CachedAnswer>>();

/**
 * Runs only on a cache miss: skips FMP when the answer is already known or calls are paused
 * after "limit reached"; remembers lasting refusals so they aren't asked again every view.
 */
async function guardedFetch(path: string, params: Record<string, string>): Promise<CachedAnswer> {
  const key = rememberKey(path, params);
  const known = await rememberedIssue(key);
  if (known) return { rows: [], fetchedAt: new Date().toISOString(), known };
  if (await isPaused()) throw new ProviderError("rate_limited"); // not cached: try again after the pause
  try {
    return await fetchFmp(path, params);
  } catch (e) {
    if (isProviderError(e) && e.kind in REMEMBER) {
      await rememberIssue(key, e.kind);
      return { rows: [], fetchedAt: new Date().toISOString(), known: e.kind }; // cached for `ttl` too
    }
    if (isProviderError(e) && e.kind === "rate_limited") await pause();
    throw e;
  }
}

/** Cached request. The cache key holds the path and parameters, never the API key. */
async function get(path: string, params: Record<string, string>, ttl: number): Promise<Fetched> {
  let cached = cachedByTtl.get(ttl);
  if (!cached) {
    cached = unstable_cache(
      (p: string, q: string) => guardedFetch(p, JSON.parse(q) as Record<string, string>),
      ["fmp", String(ttl)],
      { revalidate: ttl, tags: ["fmp"] },
    );
    cachedByTtl.set(ttl, cached);
  }
  const answer = await cached(path, JSON.stringify(params));
  if (answer.known) throw new ProviderError(answer.known);
  return answer;
}

async function attempt<T>(endpoint: string, run: () => Promise<{ data: T; fetchedAt: string }>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await run()) };
  } catch (e) {
    if (isProviderError(e)) return { ok: false, error: e.kind };
    console.error(
      JSON.stringify({
        event: "provider_parse_error",
        provider: "fmp",
        endpoint,
        message: e instanceof Error ? e.message : String(e),
      }),
    );
    return { ok: false, error: "upstream" };
  }
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

function toIso(ts: number | undefined): string | undefined {
  if (ts === undefined || ts <= 0) return undefined;
  return new Date(ts > 1e12 ? ts : ts * 1000).toISOString(); // FMP sends Unix seconds
}

export function mapQuote(q: Json): Quote {
  return {
    symbol: String(q.symbol),
    name: str(q.name) ?? String(q.symbol),
    price: num(q.price)!,
    change: num(q.change) ?? 0,
    changePercent: num(q.changePercentage) ?? num(q.changesPercentage) ?? 0,
    dayLow: num(q.dayLow),
    dayHigh: num(q.dayHigh),
    yearLow: num(q.yearLow),
    yearHigh: num(q.yearHigh),
    marketCap: num(q.marketCap),
    volume: num(q.volume),
    open: num(q.open),
    previousClose: num(q.previousClose),
    exchange: str(q.exchange),
    asOf: toIso(num(q.timestamp)),
  };
}

export function fmpQuote(symbol: string): Promise<Result<Quote>> {
  return attempt("quote", async () => {
    const { rows, fetchedAt } = await get("quote", { symbol }, await currentQuoteTtl());
    const q = rows[0];
    if (!q || num(q.price) === undefined) throw new ProviderError("not_found");
    return { data: mapQuote(q), fetchedAt };
  });
}

export function fmpProfile(symbol: string): Promise<Result<Profile>> {
  return attempt("profile", async () => {
    const { rows, fetchedAt } = await get("profile", { symbol }, TTL.fundamentals);
    const p = rows[0];
    if (!p) throw new ProviderError("not_found");
    return {
      fetchedAt,
      data: {
        symbol: String(p.symbol ?? symbol),
        companyName: str(p.companyName) ?? symbol,
        sector: str(p.sector),
        industry: str(p.industry),
        description: str(p.description),
        website: str(p.website),
        image: str(p.image),
        ceo: str(p.ceo),
        employees: num(Number(p.fullTimeEmployees)),
        country: str(p.country),
      },
    };
  });
}

export async function fmpFundamentals(symbol: string): Promise<Result<Fundamentals>> {
  const first = (path: string) =>
    attempt(path, async () => {
      const { rows, fetchedAt } = await get(path, { symbol }, TTL.fundamentals);
      return { data: rows[0] ?? {}, fetchedAt };
    });
  const [ratios, metrics] = await Promise.all([first("ratios-ttm"), first("key-metrics-ttm")]);
  if (!ratios.ok && !metrics.ok) return ratios;
  const r = ratios.ok ? ratios.data : {};
  const m = metrics.ok ? metrics.data : {};
  return {
    ok: true,
    fetchedAt: ratios.ok ? ratios.fetchedAt : (metrics as { fetchedAt: string }).fetchedAt,
    data: {
      pe: num(r.priceToEarningsRatioTTM) ?? num(r.peRatioTTM),
      ps: num(r.priceToSalesRatioTTM),
      pb: num(r.priceToBookRatioTTM),
      netMargin: num(r.netProfitMarginTTM),
      grossMargin: num(r.grossProfitMarginTTM),
      roe: num(m.returnOnEquityTTM) ?? num(r.returnOnEquityTTM),
      debtToEquity: num(r.debtToEquityRatioTTM) ?? num(r.debtEquityRatioTTM),
      currentRatio: num(r.currentRatioTTM) ?? num(m.currentRatioTTM),
      dividendYield: num(r.dividendYieldTTM),
    },
  };
}

export function fmpIncome(symbol: string): Promise<Result<AnnualIncome[]>> {
  return attempt("income-statement", async () => {
    const { rows, fetchedAt } = await get("income-statement", { symbol, limit: "5" }, TTL.fundamentals);
    const data = rows
      .map((r) => ({
        year: str(r.fiscalYear) ?? String(r.calendarYear ?? str(r.date)?.slice(0, 4) ?? ""),
        revenue: num(r.revenue) ?? 0,
        netIncome: num(r.netIncome) ?? 0,
        eps: num(r.eps),
        filingDate: (str(r.filingDate) ?? str(r.fillingDate))?.slice(0, 10),
      }))
      .reverse();
    return { data, fetchedAt };
  });
}

export function fmpHistory(symbol: string): Promise<Result<Candle[]>> {
  const from = new Date();
  from.setFullYear(from.getFullYear() - 5);
  return attempt("historical-price-eod/full", async () => {
    const { rows, fetchedAt } = await get(
      "historical-price-eod/full",
      { symbol, from: from.toISOString().slice(0, 10) },
      TTL.prices,
    );
    const data = rows
      .filter((r) => str(r.date) && num(r.close) !== undefined)
      .map((r) => ({
        time: String(r.date).slice(0, 10),
        open: num(r.open) ?? num(r.close)!,
        high: num(r.high) ?? num(r.close)!,
        low: num(r.low) ?? num(r.close)!,
        close: num(r.close)!,
        volume: num(r.volume) ?? 0,
      }))
      .sort((a, b) => (a.time < b.time ? -1 : 1));
    return { data, fetchedAt };
  });
}

const US_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX", "NYSEARCA", "CBOE", "BATS"]);

export async function fmpSearch(query: string): Promise<Result<SearchResult[]>> {
  const search = (path: string) =>
    attempt(path, async () => {
      const { rows, fetchedAt } = await get(path, { query, limit: "10" }, TTL.fundamentals);
      return { data: rows, fetchedAt };
    });
  const [bySymbol, byName] = await Promise.all([search("search-symbol"), search("search-name")]);
  if (!bySymbol.ok && !byName.ok) return bySymbol;

  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of [...(bySymbol.ok ? bySymbol.data : []), ...(byName.ok ? byName.data : [])]) {
    const symbol = str(r.symbol);
    const exchange = str(r.exchange);
    if (!symbol || seen.has(symbol)) continue;
    if (exchange && !US_EXCHANGES.has(exchange.toUpperCase())) continue; // US listings only
    seen.add(symbol);
    out.push({ symbol, name: str(r.name) ?? symbol, exchange });
  }
  const fetchedAt = bySymbol.ok ? bySymbol.fetchedAt : (byName as { fetchedAt: string }).fetchedAt;
  return { ok: true, data: out.slice(0, 10), fetchedAt };
}

// ---- Valuation inputs -------------------------------------------------------------

export interface Rate {
  value: number; // as a fraction: 0.0486 for 4.86 %
  date: string;
}

/** 4.86 → 0.0486 without float noise (FMP sends percentages with two decimals). */
const pct = (v: number) => Math.round(v * 10_000) / 1_000_000;

/** Latest 10-year US Treasury yield (constant maturity). */
export function fmpTreasury10y(): Promise<Result<Rate>> {
  const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  return attempt("treasury-rates", async () => {
    const { rows, fetchedAt } = await get("treasury-rates", { from }, TTL.rates);
    const latest = rows
      .filter((r) => str(r.date) && num(r.year10) !== undefined)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (!latest) throw new ProviderError("not_found");
    return { data: { value: pct(num(latest.year10)!), date: String(latest.date).slice(0, 10) }, fetchedAt };
  });
}

/** Total equity risk premium for the United States (mature-market premium + country risk). */
export function fmpEquityRiskPremium(): Promise<Result<Rate>> {
  return attempt("market-risk-premium", async () => {
    const { rows, fetchedAt } = await get("market-risk-premium", {}, TTL.fundamentals);
    const us = rows.find((r) => r.country === "United States");
    const v = num(us?.totalEquityRiskPremium);
    if (v === undefined) throw new ProviderError("not_found");
    return { data: { value: pct(v), date: fetchedAt.slice(0, 10) }, fetchedAt };
  });
}

/**
 * Current market caps for many symbols in one call. Plans that cover only some symbols
 * simply leave the others out, so callers must handle a partial map.
 */
export function fmpMarketCaps(symbols: string[]): Promise<Result<Record<string, number>>> {
  const list = [...new Set(symbols.map((s) => s.toUpperCase()))].sort();
  return attempt("market-capitalization-batch", async () => {
    if (list.length === 0) return { data: {}, fetchedAt: new Date().toISOString() };
    const { rows, fetchedAt } = await get("market-capitalization-batch", { symbols: list.join(",") }, TTL.fundamentals);
    const data: Record<string, number> = {};
    for (const r of rows) {
      const sym = str(r.symbol);
      const cap = num(r.marketCap);
      if (sym && cap !== undefined && cap > 0) data[sym.toUpperCase()] = cap;
    }
    return { data, fetchedAt };
  });
}

// ---- Analysts -------------------------------------------------------------------------
// Consensus figures from FMP. Lower plans cover a fixed list of large companies; for the rest
// FMP answers with a plan error, which the UI shows as such.

export interface Range {
  avg: number;
  low?: number;
  high?: number;
}

export interface AnalystEstimate {
  date: string; // end of the fiscal year the estimate is for
  revenue: Range | null;
  eps: Range | null; // usually the "adjusted" EPS analysts follow, not GAAP EPS
  analystsRevenue?: number;
  analystsEps?: number;
}

/** First numeric field among the names FMP has used for it (stable API first, then legacy). */
const pick = (r: Json, ...keys: string[]) => keys.map((k) => num(r[k])).find((v) => v !== undefined);

/** Annual consensus estimates, oldest fiscal year first (past years included). */
export function fmpAnalystEstimates(symbol: string): Promise<Result<AnalystEstimate[]>> {
  return attempt("analyst-estimates", async () => {
    const { rows, fetchedAt } = await get("analyst-estimates", { symbol, period: "annual", page: "0", limit: "10" }, TTL.fundamentals);
    const data = rows
      .filter((r) => str(r.date))
      .map((r): AnalystEstimate => {
        const rev = pick(r, "revenueAvg", "estimatedRevenueAvg");
        const eps = pick(r, "epsAvg", "estimatedEpsAvg");
        return {
          date: String(r.date).slice(0, 10),
          revenue: rev === undefined ? null : { avg: rev, low: pick(r, "revenueLow", "estimatedRevenueLow"), high: pick(r, "revenueHigh", "estimatedRevenueHigh") },
          eps: eps === undefined ? null : { avg: eps, low: pick(r, "epsLow", "estimatedEpsLow"), high: pick(r, "epsHigh", "estimatedEpsHigh") },
          analystsRevenue: pick(r, "numAnalystsRevenue", "numberAnalystEstimatedRevenue"),
          analystsEps: pick(r, "numAnalystsEps", "numberAnalystsEstimatedEps"),
        };
      })
      .filter((e) => e.revenue || e.eps)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (data.length === 0) throw new ProviderError("not_found");
    return { data, fetchedAt };
  });
}

export interface PriceTarget {
  consensus: number;
  median?: number;
  high?: number;
  low?: number;
}

export function fmpPriceTarget(symbol: string): Promise<Result<PriceTarget>> {
  return attempt("price-target-consensus", async () => {
    const { rows, fetchedAt } = await get("price-target-consensus", { symbol }, TTL.fundamentals);
    const r = rows[0];
    const consensus = r ? num(r.targetConsensus) : undefined;
    if (!r || consensus === undefined || !(consensus > 0)) throw new ProviderError("not_found");
    return { data: { consensus, median: num(r.targetMedian), high: num(r.targetHigh), low: num(r.targetLow) }, fetchedAt };
  });
}

export interface Grades {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  consensus?: string;
}

export function fmpGrades(symbol: string): Promise<Result<Grades>> {
  return attempt("grades-consensus", async () => {
    const { rows, fetchedAt } = await get("grades-consensus", { symbol }, TTL.fundamentals);
    const r = rows[0];
    if (!r) throw new ProviderError("not_found");
    const n = (k: string) => Math.max(0, Math.round(num(r[k]) ?? 0));
    const data: Grades = { strongBuy: n("strongBuy"), buy: n("buy"), hold: n("hold"), sell: n("sell"), strongSell: n("strongSell"), consensus: str(r.consensus) };
    if (data.strongBuy + data.buy + data.hold + data.sell + data.strongSell === 0) throw new ProviderError("not_found");
    return { data, fetchedAt };
  });
}
