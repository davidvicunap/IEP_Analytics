// Is a ticker still listed? From the SEC company list (kept in the `securities` table, refreshed
// weekly, old tickers kept as inactive): a ticker no longer active whose company (CIK) now has
// another active ticker was renamed (FB → META); one without a successor is gone. Pure and tested.

export type Listing = { status: "active" } | { status: "renamed"; to: string } | { status: "delisted" } | { status: "unknown" };

export interface SecurityRow {
  symbol: string;
  cik: number;
  active: boolean;
  /** Lower is a larger company: picks the main ticker when a company has several. */
  rank: number | null;
}

export function listingOf(symbol: string, rows: SecurityRow[]): Listing {
  const me = rows.find((r) => r.symbol === symbol);
  if (!me) return { status: "unknown" };
  if (me.active) return { status: "active" };
  const next = rows.filter((r) => r.cik === me.cik && r.active && r.symbol !== symbol).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))[0];
  return next ? { status: "renamed", to: next.symbol } : { status: "delisted" };
}
