// Stock splits. After a 10-for-1 split the price is a tenth of what it was, while the user's stop,
// target, fair value and logged trades are still in old prices: without this, every holder would
// get "you hit your stop". A split is detected when a new quote is a clean fraction (or multiple)
// of the last stored one while the day's change is ordinary (data providers restate the previous
// close, so a split day doesn't look like a crash). Pure and tested.

export interface Split {
  symbol: string;
  /** New shares per old share: 10 for a 10-for-1 split, 0.1 for a 1-for-10 reverse split. */
  ratio: number;
  /** The first market day at the new prices (YYYY-MM-DD). */
  date: string;
}

export const SPLIT_FACTORS = [2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50] as const;
/** How close the price ratio must be to a split factor (prices move a little between quotes too). */
const TOLERANCE = 0.06;
/** A day's change beyond this is a real move, not a split. */
const MAX_ORDINARY_MOVE = 25;
/** The previous quote must be this recent to compare. */
const MAX_AGE_DAYS = 7;

/** The split between two quotes, or null. `changePct` is the new quote's change in percent (null: unknown). */
export function detectSplit(prev: { price: number; at: string }, next: { price: number; changePct: number | null; at: string }): number | null {
  if (!(prev.price > 0) || !(next.price > 0) || next.changePct === null || Math.abs(next.changePct) > MAX_ORDINARY_MOVE) return null;
  const age = (Date.parse(next.at) - Date.parse(prev.at)) / 86_400_000;
  if (!(age > 0) || age > MAX_AGE_DAYS) return null;
  const r = prev.price / next.price;
  for (const k of SPLIT_FACTORS) {
    if (Math.abs(r / k - 1) <= TOLERANCE) return k;
    if (Math.abs(1 / r / k - 1) <= TOLERANCE) return 1 / k;
  }
  return null;
}

/** A price from before the split, in today's terms. */
export const adjustPrice = (price: number, ratio: number) => Math.round((price / ratio) * 10_000) / 10_000;

/** Splits of `symbol` that took effect after `date` (exclusive) and up to `until` (inclusive), oldest first. */
export function splitsBetween(splits: Split[], symbol: string, date: string, until = "9999-12-31"): Split[] {
  return splits.filter((s) => s.symbol === symbol && s.date > date && s.date <= until).sort((a, b) => a.date.localeCompare(b.date));
}

/** The combined ratio of several splits (two 2-for-1 splits make 4). */
export const totalRatio = (splits: Split[]) => splits.reduce((r, s) => r * s.ratio, 1);
