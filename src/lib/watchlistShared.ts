// Watchlist rules shared by the browser store and the server (account sync): pure.

/** The most a watchlist can hold. Quotes are fetched 30 at a time, so 100 means 4 requests. */
export const WATCHLIST_LIMIT = 100;
export const RECENT_LIMIT = 8;

export const SYMBOL = /^[A-Z][A-Z.\-]{0,9}$/;

/** Uppercase, valid tickers only, first occurrence wins. */
export function sanitizeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const s = item.trim().toUpperCase();
    if (!SYMBOL.test(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Insert `symbol` at `index` (or the end), keeping the list unique. */
export function insertAt(list: string[], symbol: string, index?: number): string[] {
  const rest = list.filter((s) => s !== symbol);
  const i = index === undefined ? rest.length : Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, i), symbol, ...rest.slice(i)];
}

