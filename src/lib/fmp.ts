// Server-only client for Financial Modeling Prep's "stable" API.
// - The API key is read from process.env; it never reaches the browser, cache keys or logs.
// - Every call returns a typed Result, so the UI can say exactly why data is missing.
// - Only successful responses are cached: errors throw inside the cached function,
//   so a transient 429 or plan error is retried on the next request instead of sticking.
import { unstable_cache } from "next/cache";
import type {
  AnnualIncome,
  Candle,
  DataIssue,
  Fundamentals,
  NewsItem,
  Profile,
  Quote,
  Result,
  SearchResult,
} from "./types";

const BASE = "https://financialmodelingprep.com/stable";
const TIMEOUT_MS = 8000;

/** Cache lifetimes in seconds per data class. */
export const TTL = { quote: 60, news: 900, prices: 3600, fundamentals: 86400 } as const;

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

const cachedByTtl = new Map<number, (path: string, params: string) => Promise<Fetched>>();

/** Cached request. The cache key holds the path and parameters, never the API key. */
function get(path: string, params: Record<string, string>, ttl: number): Promise<Fetched> {
  let cached = cachedByTtl.get(ttl);
  if (!cached) {
    cached = unstable_cache(
      (p: string, q: string) => fetchFmp(p, JSON.parse(q) as Record<string, string>),
      ["fmp", String(ttl)],
      { revalidate: ttl, tags: ["fmp"] },
    );
    cachedByTtl.set(ttl, cached);
  }
  return cached(path, JSON.stringify(params));
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
    const { rows, fetchedAt } = await get("quote", { symbol }, TTL.quote);
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

export function fmpNews(symbol: string): Promise<Result<NewsItem[]>> {
  return attempt("news/stock", async () => {
    const { rows, fetchedAt } = await get("news/stock", { symbols: symbol, limit: "12" }, TTL.news);
    const data = rows
      .filter((r) => str(r.title) && str(r.url))
      .map((r) => ({
        title: String(r.title),
        url: String(r.url),
        publisher: str(r.publisher) ?? str(r.site),
        publishedDate: str(r.publishedDate) ?? "",
        image: str(r.image),
        text: str(r.text),
      }));
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
