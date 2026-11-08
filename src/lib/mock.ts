// Deterministic simulated data used when no FMP_API_KEY is configured (DEMO mode).
// Numbers are illustrative only.
import type { AnnualIncome, Candle, Fundamentals, Profile, Quote, SearchResult } from "./types";

interface Seed {
  name: string;
  sector: string;
  industry: string;
  price: number;
  f: Fundamentals;
  revenue: number; // latest annual revenue, USD
}

const SEEDS: Record<string, Seed> = {
  AAPL: { name: "Apple Inc.", sector: "Technology", industry: "Consumer Electronics", price: 230, revenue: 391e9,
    f: { pe: 35, ps: 9, pb: 50, netMargin: 0.24, grossMargin: 0.46, roe: 1.5, debtToEquity: 1.8, currentRatio: 0.9, dividendYield: 0.0045 } },
  MSFT: { name: "Microsoft Corporation", sector: "Technology", industry: "Software", price: 430, revenue: 245e9,
    f: { pe: 36, ps: 13, pb: 11, netMargin: 0.36, grossMargin: 0.69, roe: 0.33, debtToEquity: 0.3, currentRatio: 1.3, dividendYield: 0.0075 } },
  NVDA: { name: "NVIDIA Corporation", sector: "Technology", industry: "Semiconductors", price: 135, revenue: 130e9,
    f: { pe: 50, ps: 25, pb: 45, netMargin: 0.55, grossMargin: 0.75, roe: 1.1, debtToEquity: 0.15, currentRatio: 4.4, dividendYield: 0.0003 } },
  AMZN: { name: "Amazon.com, Inc.", sector: "Consumer Cyclical", industry: "Internet Retail", price: 200, revenue: 638e9,
    f: { pe: 40, ps: 3.3, pb: 8, netMargin: 0.09, grossMargin: 0.49, roe: 0.22, debtToEquity: 0.6, currentRatio: 1.1, dividendYield: 0 } },
  GOOGL: { name: "Alphabet Inc.", sector: "Communication Services", industry: "Internet Content", price: 175, revenue: 350e9,
    f: { pe: 22, ps: 6, pb: 7, netMargin: 0.29, grossMargin: 0.58, roe: 0.32, debtToEquity: 0.1, currentRatio: 1.8, dividendYield: 0.005 } },
  META: { name: "Meta Platforms, Inc.", sector: "Communication Services", industry: "Internet Content", price: 580, revenue: 165e9,
    f: { pe: 27, ps: 9, pb: 8, netMargin: 0.38, grossMargin: 0.82, roe: 0.36, debtToEquity: 0.3, currentRatio: 2.7, dividendYield: 0.0035 } },
  TSLA: { name: "Tesla, Inc.", sector: "Consumer Cyclical", industry: "Auto Manufacturers", price: 250, revenue: 97e9,
    f: { pe: 90, ps: 9, pb: 11, netMargin: 0.07, grossMargin: 0.18, roe: 0.1, debtToEquity: 0.2, currentRatio: 2, dividendYield: 0 } },
  JPM: { name: "JPMorgan Chase & Co.", sector: "Financial Services", industry: "Banks", price: 240, revenue: 177e9,
    f: { pe: 12, ps: 3.8, pb: 2, netMargin: 0.33, roe: 0.17, debtToEquity: 1.3, dividendYield: 0.021 } },
  KO: { name: "The Coca-Cola Company", sector: "Consumer Defensive", industry: "Beverages", price: 68, revenue: 47e9,
    f: { pe: 27, ps: 6.2, pb: 11, netMargin: 0.23, grossMargin: 0.61, roe: 0.4, debtToEquity: 1.6, currentRatio: 1.0, dividendYield: 0.029 } },
  SPY: { name: "SPDR S&P 500 ETF", sector: "ETF", industry: "Index Fund", price: 580, revenue: 0, f: {} },
  QQQ: { name: "Invesco QQQ Trust", sector: "ETF", industry: "Index Fund", price: 500, revenue: 0, f: {} },
  DIA: { name: "SPDR Dow Jones ETF", sector: "ETF", industry: "Index Fund", price: 430, revenue: 0, f: {} },
  IWM: { name: "iShares Russell 2000 ETF", sector: "ETF", industry: "Index Fund", price: 225, revenue: 0, f: {} },
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFor(symbol: string): Seed {
  const s = SEEDS[symbol];
  if (s) return s;
  const r = rng(hash(symbol));
  return {
    name: `${symbol} Corp. (demo)`,
    sector: "Industrials",
    industry: "Diversified",
    price: 20 + r() * 300,
    revenue: (1 + r() * 50) * 1e9,
    f: {
      pe: 8 + r() * 40, ps: 0.5 + r() * 10, pb: 1 + r() * 8, netMargin: -0.05 + r() * 0.3,
      grossMargin: 0.2 + r() * 0.5, roe: r() * 0.35, debtToEquity: r() * 2.5, currentRatio: 0.6 + r() * 2.5,
      dividendYield: r() > 0.5 ? r() * 0.04 : 0,
    },
  };
}

const isValidSymbol = (s: string) => /^[A-Z][A-Z.\-]{0,6}$/.test(s);

export function mockHistory(symbol: string): Candle[] {
  const seed = seedFor(symbol);
  const r = rng(hash(symbol + ":h"));
  const days: Candle[] = [];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 5);
  // Random walk ending at the seed price: generate returns then scale.
  const dates: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) dates.push(d.toISOString().slice(0, 10));
  }
  const rets = dates.map(() => 0.0004 + (r() - 0.5) * 0.04 + Math.sin(r() * 6) * 0.002);
  let p = 1;
  const closes = rets.map((x) => (p *= 1 + x));
  const scale = seed.price / closes[closes.length - 1];
  let prev = closes[0] * scale;
  dates.forEach((time, i) => {
    const close = closes[i] * scale;
    const open = prev;
    const high = Math.max(open, close) * (1 + r() * 0.012);
    const low = Math.min(open, close) * (1 - r() * 0.012);
    days.push({ time, open, high, low, close, volume: Math.round((20 + r() * 60) * 1e6) });
    prev = close;
  });
  return days;
}

export function mockQuote(symbol: string): Quote | null {
  if (!isValidSymbol(symbol)) return null;
  const seed = seedFor(symbol);
  const h = mockHistory(symbol);
  const last = h[h.length - 1];
  const prev = h[h.length - 2];
  const year = h.slice(-252);
  return {
    symbol,
    name: seed.name,
    price: last.close,
    change: last.close - prev.close,
    changePercent: ((last.close - prev.close) / prev.close) * 100,
    dayLow: last.low,
    dayHigh: last.high,
    yearLow: Math.min(...year.map((c) => c.low)),
    yearHigh: Math.max(...year.map((c) => c.high)),
    marketCap: seed.revenue ? seed.revenue * (seed.f.ps ?? 3) : undefined,
    volume: last.volume,
    open: last.open,
    previousClose: prev.close,
    exchange: "NASDAQ",
  };
}

export function mockProfile(symbol: string): Profile {
  const s = seedFor(symbol);
  return {
    symbol,
    companyName: s.name,
    sector: s.sector,
    industry: s.industry,
    description: `${s.name} — simulated company profile shown in demo mode. Add an FMP_API_KEY to see real data.`,
    country: "US",
  };
}

export function mockFundamentals(symbol: string): Fundamentals {
  return seedFor(symbol).f;
}

export function mockIncome(symbol: string): AnnualIncome[] {
  const s = seedFor(symbol);
  if (!s.revenue) return [];
  const r = rng(hash(symbol + ":i"));
  const thisYear = new Date().getFullYear() - 1;
  const out: AnnualIncome[] = [];
  let rev = s.revenue;
  for (let i = 0; i < 5; i++) {
    const margin = (s.f.netMargin ?? 0.1) * (0.85 + r() * 0.3);
    out.unshift({ year: String(thisYear - i), revenue: rev, netIncome: rev * margin });
    rev = rev / (1 + 0.02 + r() * 0.15);
  }
  return out;
}

export function mockSearch(query: string): SearchResult[] {
  const q = query.toUpperCase();
  return Object.entries(SEEDS)
    .filter(([sym, s]) => sym.startsWith(q) || s.name.toUpperCase().includes(q))
    .map(([symbol, s]) => ({ symbol, name: s.name, exchange: "NASDAQ" }))
    .slice(0, 10);
}
