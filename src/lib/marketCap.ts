// Market value from SEC share counts and a price, so comps don't depend on a paid market-cap
// feed. Shares come from the latest report's cover page (dei:EntityCommonStockSharesOutstanding,
// summed over the share classes it lists); when a company doesn't report a usable total there,
// from its diluted shares (net income ÷ diluted EPS) for the comps year.
import type { RatioInputs } from "./ratios";

export interface CoverShares {
  value: number;
  /** The date the count refers to (usually a few weeks after the period end). */
  end: string;
  filed: string;
  accn: string;
  form: string;
}

interface ConceptFact {
  end?: unknown;
  val?: unknown;
  accn?: unknown;
  form?: unknown;
  filed?: unknown;
}

/** The latest filing's cover-page count, from the SEC companyconcept JSON; null when there's none. */
export function parseCoverShares(json: unknown): CoverShares | null {
  const facts = ((json as { units?: { shares?: ConceptFact[] } } | null)?.units?.shares ?? []).filter(
    (f): f is { end: string; val: number; accn: string; form: string; filed: string } =>
      typeof f.end === "string" && typeof f.val === "number" && f.val > 0 && typeof f.accn === "string" && typeof f.filed === "string",
  );
  if (facts.length === 0) return null;
  const latest = facts.reduce((a, b) => (b.filed > a.filed || (b.filed === a.filed && b.end > a.end) ? b : a));
  // One filing lists each class of stock as its own fact for the same date.
  const same = facts.filter((f) => f.accn === latest.accn && f.end === latest.end);
  return { value: same.reduce((s, f) => s + f.val, 0), end: latest.end, filed: latest.filed, accn: latest.accn, form: String(latest.form ?? "") };
}

export interface MarketCap {
  value: number;
  shares: number;
  sharesSource: "cover" | "diluted";
  /** Cover page: the count's date. Diluted: the fiscal year of the figures. */
  sharesAsOf: string;
  accn?: string;
  price: number;
  priceAt: string;
}

const DAY = 86_400_000;
/** A cover count older than this (a company that stopped tagging it) isn't used. */
export const COVER_MAX_AGE_DAYS = 400;

/**
 * Price × shares. The cover count when it is recent; else net income ÷ diluted EPS, kept only
 * when the price over that EPS is a plausible earnings multiple (a ratio far outside 1–2,000
 * means the EPS is for another share class, as with Berkshire's A and B shares).
 */
export function marketCapFrom(
  price: number | null,
  priceAt: string | null,
  cover: CoverShares | null,
  inputs: RatioInputs | null,
  year: number,
  now: Date,
): MarketCap | null {
  if (!(price && price > 0) || !priceAt) return null;
  if (cover && now.getTime() - Date.parse(cover.filed) <= COVER_MAX_AGE_DAYS * DAY) {
    return { value: price * cover.value, shares: cover.value, sharesSource: "cover", sharesAsOf: cover.end, accn: cover.accn, price, priceAt };
  }
  const ni = inputs?.netIncome;
  const eps = inputs?.eps;
  if (ni === undefined || eps === undefined || ni === 0 || eps === 0 || Math.sign(ni) !== Math.sign(eps)) return null;
  const multiple = Math.abs(price / eps);
  if (multiple < 1 || multiple > 2000) return null;
  const shares = ni / eps;
  return { value: price * shares, shares, sharesSource: "diluted", sharesAsOf: `FY${year}`, price, priceAt };
}
