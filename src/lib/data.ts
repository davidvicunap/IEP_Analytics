// Server-side data facade: real FMP data when a key exists, demo data otherwise.
import * as fmp from "./fmp";
import * as mock from "./mock";
import type { Quote, SearchResult, StockBundle } from "./types";

export const isDemo = () => !fmp.hasFmpKey();

export function normalizeSymbol(raw: string): string | null {
  const s = decodeURIComponent(raw).trim().toUpperCase();
  return /^[A-Z][A-Z.\-]{0,9}$/.test(s) ? s : null;
}

export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  const list = [...new Set(symbols.map(normalizeSymbol).filter((s): s is string => !!s))].slice(0, 30);
  const quotes = await Promise.all(list.map((s) => (isDemo() ? mock.mockQuote(s) : fmp.fmpQuote(s))));
  return quotes.filter((q): q is Quote => !!q);
}

export async function getStockBundle(symbol: string): Promise<StockBundle | null> {
  if (isDemo()) {
    const quote = mock.mockQuote(symbol);
    if (!quote) return null;
    return {
      quote,
      profile: mock.mockProfile(symbol),
      fundamentals: mock.mockFundamentals(symbol),
      income: mock.mockIncome(symbol),
      history: mock.mockHistory(symbol),
      news: mock.mockNews(symbol),
      demo: true,
    };
  }
  const quote = await fmp.fmpQuote(symbol);
  if (!quote) return null;
  const [profile, fundamentals, income, history, news] = await Promise.all([
    fmp.fmpProfile(symbol),
    fmp.fmpFundamentals(symbol),
    fmp.fmpIncome(symbol),
    fmp.fmpHistory(symbol),
    fmp.fmpNews(symbol),
  ]);
  return { quote, profile, fundamentals, income, history, news, demo: false };
}

export async function searchSymbols(query: string): Promise<SearchResult[]> {
  const q = query.trim().slice(0, 40);
  if (!q) return [];
  return isDemo() ? mock.mockSearch(q) : fmp.fmpSearch(q);
}
