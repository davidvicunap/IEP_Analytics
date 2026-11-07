// Server-side: valuation for a ticker. Prices and market caps come from FMP (licensed data,
// so this is served behind the beta gate); fundamentals from SEC filings. Each part fails on
// its own: a missing peer price never hides the company's own multiples, and so on.
import { getDb, type Db } from "@/db/client";
import { getQuote, isDemo } from "./data";
import { cagr, makerDefaults, type MakerAssumptions, type MakerBase, type MakerData } from "./dcfModel";
import { getFinancials } from "./financials";
import { fmpEquityRiskPremium, fmpHistory, fmpMarketCaps, fmpTreasury10y, type Rate } from "./fmp";
import { companyYearInputs, ensureSic, latestMetricsYear, listedPeers } from "./peers";
import { businessType, type BusinessType } from "./ratios";
import type { StatementSet } from "./secFinancials";
import type { DataIssue, Result } from "./types";
import {
  MULTIPLES, historyStats, marketBeta, multipleHistory, multipleNote, multiplesFor, peerComparison, sharesConsistency, ttmAt, ttmSeries,
  yearMultiples, type HistoryStats, type MultipleKey, type MultipleNote, type PeerComparison,
} from "./valuation";

export type HistoryIssue = DataIssue | "noShares" | "sharesMismatch" | "shortHistory";
export type PeersIssue = DataIssue | "noSic" | "noPeerData" | "fewPeers";

export interface MultipleRow {
  key: MultipleKey;
  applicable: boolean;
  higherIsCheaper: boolean;
  value: number | null; // now: quote market cap ÷ latest public TTM
  note: MultipleNote | null;
  own: HistoryStats | null; // vs its month-ends of the last 5 years
  peers: (PeerComparison & { year: number }) | null; // vs peers, all on the same fiscal year
}

export interface ValuationPayload {
  symbol: string;
  businessType: BusinessType;
  price: number;
  marketCap: number;
  quoteAt: string;
  ttm: { label: string; end: string; revenue?: number; netIncome?: number; fcf?: number; equity?: number } | null;
  multiples: MultipleRow[];
  monthly: { date: string; pe: number | null; ps: number | null; pb: number | null; fcfYield: number | null }[];
  history: { issue: HistoryIssue | null; from: string | null };
  peers: { issue: PeersIssue | null; year: number | null; priced: number; requested: number };
  maker: {
    issue: "notApplicable" | "noRevenue" | null;
    ttmLabel: string | null;
    base: MakerBase | null;
    data: MakerData | null; // the figures the defaults come from, shown next to the inputs
    defaults: MakerAssumptions | null;
    conventions: string[]; // defaults that are conventions, not data
    beta: { value: number; months: number } | null;
    rf: Rate | null;
    erp: Rate | null;
    ratesIssue: DataIssue | null;
  };
}

const SHARES_TOLERANCE = 0.1; // SEC share count vs the quote's: beyond 10 % (e.g. share classes), skip history

/** 5-year revenue CAGR from annual statements, only across exactly five fiscal years. */
export function revenueCagr5(annual: StatementSet): number | null {
  const rev = annual.lines.revenue;
  const n = annual.periods.length - 1;
  if (!rev || n < 5) return null;
  const years = (Date.parse(annual.periods[n].end) - Date.parse(annual.periods[n - 5].end)) / (365.25 * 86_400_000);
  if (Math.abs(years - 5) > 0.1) return null;
  return cagr(rev[n - 5].value ?? NaN, rev[n].value ?? NaN, 5);
}

async function peerSection(db: Db, cik: number, sic: number | null, marketCap: number) {
  const none = (issue: PeersIssue, year: number | null = null) => ({
    comparisons: {} as Partial<Record<MultipleKey, MultipleRow["peers"]>>,
    meta: { issue, year, priced: 0, requested: 0 },
  });
  if (!sic) return none("noSic");
  const latest = await latestMetricsYear(db);
  if (!latest) return none("noPeerData");
  const year = latest.year;
  const own = await companyYearInputs(db, cik, year);
  const peers = await listedPeers(db, sic, year, cik);
  if (!own || peers.length === 0) return none("noPeerData", year);

  const caps = await fmpMarketCaps(peers.map((p) => p.symbol));
  if (!caps.ok) return none(caps.error, year);
  const priced = peers
    .filter((p) => caps.data[p.symbol] !== undefined)
    .map((p) => ({ sic: p.sic, values: yearMultiples(caps.data[p.symbol], p.inputs) }));

  const mine = yearMultiples(marketCap, own);
  const comparisons: Partial<Record<MultipleKey, MultipleRow["peers"]>> = {};
  for (const m of MULTIPLES) {
    const v = mine[m.key];
    const c = v === null ? null : peerComparison(m.key, v, sic, priced);
    comparisons[m.key] = c && { ...c, year };
  }
  const anyComparison = Object.values(comparisons).some(Boolean);
  return {
    comparisons,
    meta: { issue: anyComparison ? null : ("fewPeers" as const), year, priced: priced.length, requested: peers.length },
  };
}

export async function getValuation(symbol: string): Promise<Result<ValuationPayload>> {
  const db = getDb();
  if (!db || isDemo()) return { ok: false, error: "not_configured" }; // never mix simulated prices with real filings

  const quote = await getQuote(symbol);
  if (!quote.ok) return quote;
  const { price, marketCap } = quote.data;
  if (!(price > 0) || !(marketCap && marketCap > 0)) return { ok: false, error: "not_found" };

  const fin = await getFinancials(symbol);
  if (!fin.ok) return fin;
  const { cik, annual, quarterly, shares } = fin.data;

  try {
    let sic: number | null = null;
    try {
      sic = (await ensureSic(db, cik)).sic;
    } catch {
      sic = null;
    }
    const type = businessType(sic);
    const today = new Date().toISOString().slice(0, 10);
    const series = ttmSeries(quarterly);
    const ttm = ttmAt(series, today);
    const now = multiplesFor(marketCap, ttm);

    // Own history: month-end market cap from split-adjusted closes × SEC share counts.
    const [prices, market, peers, rf, erp] = await Promise.all([
      fmpHistory(symbol),
      fmpHistory("SPY"), // market proxy for beta
      peerSection(db, cik, sic, marketCap),
      fmpTreasury10y(),
      fmpEquityRiskPremium(),
    ]);
    let historyIssue: HistoryIssue | null = null;
    let monthly: ValuationPayload["monthly"] = [];
    let hist: ReturnType<typeof multipleHistory> = [];
    if (!prices.ok) historyIssue = prices.error;
    else if (shares.points.length === 0) historyIssue = "noShares";
    else {
      const ratio = sharesConsistency(shares, marketCap, price);
      if (ratio === null || Math.abs(ratio - 1) > SHARES_TOLERANCE) historyIssue = "sharesMismatch";
      else {
        hist = multipleHistory(prices.data, shares, series);
        monthly = hist.map((h) => ({ date: h.date, ...h.values }));
      }
    }

    const multiples: MultipleRow[] = MULTIPLES.map((m) => {
      const applicable = m.appliesTo.includes(type);
      const value = applicable ? now[m.key] : null;
      return {
        key: m.key,
        applicable,
        higherIsCheaper: m.higherIsCheaper,
        value,
        note: applicable ? multipleNote(m.key, ttm) : null,
        own: applicable && value !== null && hist.length ? historyStats(hist, m.key, value) : null,
        peers: applicable ? (peers.comparisons[m.key] ?? null) : null,
      };
    });
    if (!historyIssue && multiples.every((m) => !m.own)) historyIssue = "shortHistory";

    const beta = prices.ok && market.ok ? marketBeta(prices.data, market.data) : null;
    const dcfApplicable = type === "general" || type === "reit";
    let maker: ValuationPayload["maker"] = {
      issue: dcfApplicable ? null : "notApplicable",
      ttmLabel: ttm?.label ?? null,
      base: null,
      data: null,
      defaults: null,
      conventions: [],
      beta,
      rf: rf.ok ? rf.data : null,
      erp: erp.ok ? erp.data : null,
      ratesIssue: !rf.ok ? rf.error : !erp.ok ? erp.error : null,
    };
    if (dcfApplicable) {
      if (!ttm?.revenue || ttm.revenue <= 0) maker = { ...maker, issue: "noRevenue" };
      else {
        const base: MakerBase = { revenue0: ttm.revenue, marketCap, price, debt: ttm.debt ?? 0, cash: ttm.cash ?? 0 };
        const data: MakerData = {
          revenue: ttm.revenue,
          ebit: ttm.ebit ?? null,
          da: ttm.da ?? null,
          capex: ttm.capex ?? null,
          incomeTax: ttm.incomeTax ?? null,
          pretaxIncome: ttm.pretaxIncome ?? null,
          interestExpense: ttm.interestExpense ?? null,
          revenueCagr5: revenueCagr5(annual),
          rf: rf.ok ? rf.data.value : null,
          erp: erp.ok ? erp.data.value : null,
          beta: beta?.value ?? null,
        };
        const { assumptions, conventions } = makerDefaults(data, base);
        maker = { ...maker, base, data, defaults: assumptions, conventions };
      }
    }

    return {
      ok: true,
      fetchedAt: quote.fetchedAt,
      data: {
        symbol: fin.data.symbol,
        businessType: type,
        price,
        marketCap,
        quoteAt: quote.data.asOf ?? quote.fetchedAt,
        ttm: ttm ? { label: ttm.label, end: ttm.end, revenue: ttm.revenue, netIncome: ttm.netIncome, fcf: ttm.fcf, equity: ttm.equity } : null,
        multiples,
        monthly,
        history: { issue: historyIssue, from: monthly[0]?.date ?? null },
        peers: peers.meta,
        maker,
      },
    };
  } catch (e) {
    console.error(JSON.stringify({ event: "valuation_error", symbol, message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, error: "upstream" };
  }
}
