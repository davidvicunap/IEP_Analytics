/** Why a piece of data is missing. Every kind has its own message in the UI. */
export type DataIssue =
  | "not_configured" // no data provider configured on the server
  | "not_found" // the provider has no data for this symbol
  | "plan_restricted" // not included in the current data plan
  | "rate_limited" // provider quota or rate limit reached
  | "unauthorized" // provider rejected the API key
  | "upstream"; // provider error, timeout or malformed response

export type Result<T> = { ok: true; data: T; fetchedAt: string } | { ok: false; error: DataIssue };

/** Where the numbers come from. DEMO is simulated data, never served in production by default. */
export type DataSource = "FMP" | "DEMO";

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  dayLow?: number;
  dayHigh?: number;
  yearLow?: number;
  yearHigh?: number;
  marketCap?: number;
  volume?: number;
  open?: number;
  previousClose?: number;
  exchange?: string;
  asOf?: string; // ISO time of the last trade reported by the provider
}

export interface QuoteEntry {
  symbol: string;
  quote?: Quote;
  fetchedAt?: string;
  error?: DataIssue;
}

export interface Profile {
  symbol: string;
  companyName: string;
  sector?: string;
  industry?: string;
  description?: string;
  website?: string;
  image?: string;
  ceo?: string;
  employees?: number;
  country?: string;
}

export interface Fundamentals {
  pe?: number;
  ps?: number;
  pb?: number;
  netMargin?: number; // fraction, 0.25 = 25%
  grossMargin?: number;
  roe?: number;
  debtToEquity?: number;
  currentRatio?: number;
  dividendYield?: number;
}

export interface AnnualIncome {
  year: string;
  revenue: number;
  netIncome: number;
  eps?: number;
  filingDate?: string; // date the annual report was filed (YYYY-MM-DD)
}

export interface Candle {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange?: string;
}

export interface StockBundle {
  source: DataSource;
  quote: Quote;
  quoteFetchedAt: string;
  profile: Result<Profile>;
  fundamentals: Result<Fundamentals>;
  income: Result<AnnualIncome[]>; // oldest -> newest
  history: Result<Candle[]>; // oldest -> newest
}
