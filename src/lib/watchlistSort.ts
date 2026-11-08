import type { QuoteView } from "./useQuotes";

export type Sort = "saved" | "changeDesc" | "changeAsc" | "symbol";

/** Watchlist order. Rows without a price always go last, so gaps never look like extremes. */
export function sortItems<T extends Pick<QuoteView, "symbol" | "quote">>(items: T[], sort: Sort): T[] {
  if (sort === "saved") return items;
  const out = [...items];
  if (sort === "symbol") return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
  const chg = (v: T) => v.quote?.changePercent;
  return out.sort((a, b) => {
    const x = chg(a);
    const y = chg(b);
    if (x === undefined) return y === undefined ? 0 : 1;
    if (y === undefined) return -1;
    return sort === "changeDesc" ? y - x : x - y;
  });
}
