// Server-side: chartable series for one company.
// - Fundamentals from SEC statements (public data, cached for 6 hours).
// - Monthly price, market cap and multiples from FMP prices + SEC figures (licensed data,
//   served behind the beta gate; one price-history call per company, cached by fmp.ts).
import { unstable_cache } from "next/cache";
import { fundamentalSeries, type PeriodSeries } from "./chartMetrics";
import { getQuote, isDemo } from "./data";
import { getFinancials } from "./financials";
import { fmpHistory } from "./fmp";
import { multipleHistory, sharesConsistency, ttmSeries } from "./valuation";
import type { DataIssue, Result } from "./types";

export interface FundamentalSeriesPayload {
  symbol: string;
  name: string;
  annual: PeriodSeries;
  quarterly: PeriodSeries;
}

class SeriesError extends Error {
  constructor(readonly kind: DataIssue) {
    super(`series:${kind}`);
  }
}

const cachedFundamentals = unstable_cache(
  async (symbol: string): Promise<{ data: FundamentalSeriesPayload; fetchedAt: string }> => {
    const fin = await getFinancials(symbol);
    if (!fin.ok) throw new SeriesError(fin.error);
    const { annual, quarterly, shares, entityName } = fin.data;
    return {
      data: {
        symbol: fin.data.symbol,
        name: entityName,
        annual: fundamentalSeries(annual, shares.splits, "annual"),
        quarterly: fundamentalSeries(quarterly, shares.splits, "quarterly"),
      },
      fetchedAt: fin.fetchedAt,
    };
  },
  ["sec-series-v1"],
  { revalidate: 21_600, tags: ["sec"] },
);

export async function getFundamentalSeries(symbol: string): Promise<Result<FundamentalSeriesPayload>> {
  try {
    const { data, fetchedAt } = await cachedFundamentals(symbol);
    return { ok: true, data, fetchedAt };
  } catch (e) {
    if (e instanceof SeriesError) return { ok: false, error: e.kind };
    console.error(JSON.stringify({ event: "series_error", symbol, message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, error: "upstream" };
  }
}

export interface MarketSeriesPayload {
  symbol: string;
  monthly: PeriodSeries;
  /** Multiples and market cap are left out when SEC share counts don't match the quote. */
  multiples: "ok" | "sharesMismatch" | "noFilings";
}

const SHARES_TOLERANCE = 0.1;

export async function getMarketSeries(symbol: string): Promise<Result<MarketSeriesPayload>> {
  if (isDemo()) return { ok: false, error: "not_configured" }; // never mix simulated prices with real filings
  const [prices, fin, quote] = await Promise.all([fmpHistory(symbol), getFinancials(symbol), getQuote(symbol)]);
  if (!prices.ok) return prices;
  const byMonth = new Map<string, { date: string; close: number }>();
  for (const c of prices.data) if (c.close > 0) byMonth.set(c.time.slice(0, 7), { date: c.time, close: c.close });
  const keys = [...byMonth.keys()];
  const values: PeriodSeries["values"] = { price: keys.map((k) => byMonth.get(k)!.close) };
  let multiples: MarketSeriesPayload["multiples"] = "noFilings";
  if (fin.ok && quote.ok && quote.data.marketCap) {
    const r = sharesConsistency(fin.data.shares, quote.data.marketCap, quote.data.price);
    if (r !== null && Math.abs(r - 1) <= SHARES_TOLERANCE) {
      multiples = "ok";
      const hist = new Map(multipleHistory(prices.data, fin.data.shares, ttmSeries(fin.data.quarterly)).map((h) => [h.date.slice(0, 7), h]));
      const pick = (f: (h: NonNullable<ReturnType<typeof hist.get>>) => number | null) => keys.map((k) => (hist.has(k) ? f(hist.get(k)!) : null));
      values.marketCap = pick((h) => h.marketCap);
      values.pe = pick((h) => h.values.pe);
      values.ps = pick((h) => h.values.ps);
      values.pb = pick((h) => h.values.pb);
      values.evEbitda = pick((h) => h.values.evEbitda);
      values.fcfYield = pick((h) => h.values.fcfYield);
    } else multiples = "sharesMismatch";
  }
  return {
    ok: true,
    fetchedAt: prices.fetchedAt,
    data: { symbol, monthly: { keys, ends: keys.map((k) => byMonth.get(k)!.date), values }, multiples },
  };
}
