// Server-only client for Financial Modeling Prep "stable" API.
// The API key is read from process.env and never sent to the browser.
import type {
  AnnualIncome,
  Candle,
  Fundamentals,
  NewsItem,
  Profile,
  Quote,
  SearchResult,
} from "./types";

const BASE = "https://financialmodelingprep.com/stable";

export function hasFmpKey(): boolean {
  return Boolean(process.env.FMP_API_KEY);
}

type Json = Record<string, unknown>;

/** Fetches an FMP endpoint. Returns null on any error (bad ticker, plan limit, network). */
async function get(path: string, params: Record<string, string>, revalidate: number): Promise<Json[] | null> {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;
  const qs = new URLSearchParams({ ...params, apikey: key });
  try {
    const res = await fetch(`${BASE}/${path}?${qs}`, { next: { revalidate } });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (Array.isArray(data)) return data as Json[];
    // Some endpoints wrap results; errors come back as {"Error Message": ...}
    if (data && typeof data === "object" && Array.isArray((data as Json).historical)) {
      return (data as { historical: Json[] }).historical;
    }
    return null;
  } catch {
    return null;
  }
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export async function fmpQuote(symbol: string): Promise<Quote | null> {
  const rows = await get("quote", { symbol }, 60);
  const q = rows?.[0];
  if (!q || num(q.price) === undefined) return null;
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
  };
}

export async function fmpProfile(symbol: string): Promise<Profile | null> {
  const p = (await get("profile", { symbol }, 86400))?.[0];
  if (!p) return null;
  return {
    symbol: String(p.symbol),
    companyName: str(p.companyName) ?? symbol,
    sector: str(p.sector),
    industry: str(p.industry),
    description: str(p.description),
    website: str(p.website),
    image: str(p.image),
    ceo: str(p.ceo),
    employees: num(Number(p.fullTimeEmployees)),
    country: str(p.country),
  };
}

export async function fmpFundamentals(symbol: string): Promise<Fundamentals> {
  const [ratios, metrics] = await Promise.all([
    get("ratios-ttm", { symbol }, 86400),
    get("key-metrics-ttm", { symbol }, 86400),
  ]);
  const r = ratios?.[0] ?? {};
  const m = metrics?.[0] ?? {};
  return {
    pe: num(r.priceToEarningsRatioTTM) ?? num(r.peRatioTTM),
    ps: num(r.priceToSalesRatioTTM),
    pb: num(r.priceToBookRatioTTM),
    netMargin: num(r.netProfitMarginTTM),
    grossMargin: num(r.grossProfitMarginTTM),
    roe: num(m.returnOnEquityTTM) ?? num(r.returnOnEquityTTM),
    debtToEquity: num(r.debtToEquityRatioTTM) ?? num(r.debtEquityRatioTTM),
    currentRatio: num(r.currentRatioTTM) ?? num(m.currentRatioTTM),
    dividendYield: num(r.dividendYieldTTM),
  };
}

export async function fmpIncome(symbol: string): Promise<AnnualIncome[]> {
  const rows = (await get("income-statement", { symbol, limit: "5" }, 86400)) ?? [];
  return rows
    .map((r) => ({
      year: str(r.fiscalYear) ?? String(r.calendarYear ?? str(r.date)?.slice(0, 4) ?? ""),
      revenue: num(r.revenue) ?? 0,
      netIncome: num(r.netIncome) ?? 0,
      eps: num(r.eps),
    }))
    .reverse();
}

export async function fmpHistory(symbol: string): Promise<Candle[]> {
  const from = new Date();
  from.setFullYear(from.getFullYear() - 5);
  const rows =
    (await get("historical-price-eod/full", { symbol, from: from.toISOString().slice(0, 10) }, 3600)) ?? [];
  return rows
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
}

export async function fmpNews(symbol: string): Promise<NewsItem[] | null> {
  const rows = await get("news/stock", { symbols: symbol, limit: "12" }, 900);
  if (!rows) return null;
  return rows
    .filter((r) => str(r.title) && str(r.url))
    .map((r) => ({
      title: String(r.title),
      url: String(r.url),
      publisher: str(r.publisher) ?? str(r.site),
      publishedDate: str(r.publishedDate) ?? "",
      image: str(r.image),
      text: str(r.text),
    }));
}

export async function fmpSearch(query: string): Promise<SearchResult[]> {
  const [bySymbol, byName] = await Promise.all([
    get("search-symbol", { query, limit: "10" }, 86400),
    get("search-name", { query, limit: "10" }, 86400),
  ]);
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of [...(bySymbol ?? []), ...(byName ?? [])]) {
    const symbol = str(r.symbol);
    const exchange = str(r.exchange);
    // Keep US listings only
    if (!symbol || seen.has(symbol)) continue;
    if (exchange && !["NASDAQ", "NYSE", "AMEX", "NYSEARCA", "CBOE", "BATS"].includes(exchange.toUpperCase())) continue;
    seen.add(symbol);
    out.push({ symbol, name: str(r.name) ?? symbol, exchange });
  }
  return out.slice(0, 10);
}
