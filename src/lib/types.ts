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
}

export interface Candle {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NewsItem {
  title: string;
  url: string;
  publisher?: string;
  publishedDate: string;
  image?: string;
  text?: string;
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange?: string;
}

export interface StockBundle {
  quote: Quote;
  profile: Profile | null;
  fundamentals: Fundamentals;
  income: AnnualIncome[]; // oldest -> newest
  history: Candle[]; // oldest -> newest
  news: NewsItem[] | null; // null = unavailable on current plan
  demo: boolean;
}
