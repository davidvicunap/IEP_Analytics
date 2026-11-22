// "Mi cartera": what the user owns, each holding with one light and the reason for it, in the
// order that matters (a delisting or a broken stop before an upcoming report). Pure and tested;
// the page gathers the inputs (trades, quotes, notebooks, SEC summaries, listings).
import type { Position } from "./trades";
import type { ThesisStatus } from "./thesis";

export type Light = "red" | "amber" | "green" | "gray";

export type Reason =
  | { kind: "delisted" }
  | { kind: "renamed"; to: string }
  | { kind: "noPrice" }
  | { kind: "belowStop"; stop: number }
  | { kind: "atRisk" }
  | { kind: "results"; date: string; days: number }
  | { kind: "nearStop"; stop: number; gap: number }
  | { kind: "report"; form: string; filed: string }
  | { kind: "noExit" }
  | { kind: "ok"; stop: number; gap: number };

const LIGHT: Record<Reason["kind"], Light> = {
  delisted: "red",
  renamed: "amber",
  noPrice: "gray",
  belowStop: "red",
  atRisk: "red",
  results: "amber",
  nearStop: "amber",
  report: "amber",
  noExit: "amber",
  ok: "green",
};

export interface HoldingInput {
  position: Position;
  price: number | null;
  /** The stop from the stock's notebook (null: none set). */
  stop: number | null;
  thesis: ThesisStatus | null;
  nextResults: string | null;
  lastReport: { form: string; filed: string } | null;
  listing: { status: "active" | "renamed" | "delisted" | "unknown"; to?: string } | null;
  today: string;
}

/** Results this close, a report this recent, or a stop this near count as news. */
export const SOON_DAYS = 7;
export const RECENT_REPORT_DAYS = 7;
export const NEAR_STOP = 0.05;

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Every reason that applies, most urgent first; the first one sets the light. */
export function holdingReasons(h: HoldingInput): Reason[] {
  const out: Reason[] = [];
  if (h.listing?.status === "delisted") out.push({ kind: "delisted" });
  if (h.listing?.status === "renamed" && h.listing.to) out.push({ kind: "renamed", to: h.listing.to });
  const stop = h.stop ?? h.position.stop;
  if (h.price === null) out.push({ kind: "noPrice" });
  else if (stop !== null && h.price <= stop) out.push({ kind: "belowStop", stop });
  if (h.thesis === "atRisk") out.push({ kind: "atRisk" });
  if (h.nextResults) {
    const days = daysBetween(h.today, h.nextResults);
    if (days >= 0 && days <= SOON_DAYS) out.push({ kind: "results", date: h.nextResults, days });
  }
  if (h.price !== null && stop !== null && h.price > stop) {
    const gap = h.price / stop - 1;
    if (gap <= NEAR_STOP) out.push({ kind: "nearStop", stop, gap });
  }
  if (h.lastReport) {
    const age = daysBetween(h.lastReport.filed, h.today);
    if (age >= 0 && age <= RECENT_REPORT_DAYS) out.push({ kind: "report", form: h.lastReport.form, filed: h.lastReport.filed });
  }
  if (stop === null) out.push({ kind: "noExit" });
  if (!out.length && h.price !== null && stop !== null) out.push({ kind: "ok", stop, gap: h.price / stop - 1 });
  return out;
}

export function holdingLight(reasons: Reason[]): Light {
  return reasons.length ? LIGHT[reasons[0].kind] : "gray";
}

export interface Totals {
  cost: number;
  /** Market value of the holdings that have a price. */
  value: number;
  gain: number;
  /** Holdings without a price (their value isn't in the total). */
  unpriced: number;
}

export function totals(rows: { position: Position; price: number | null }[]): Totals {
  let cost = 0;
  let value = 0;
  let pricedCost = 0;
  let unpriced = 0;
  for (const r of rows) {
    cost += r.position.cost;
    if (r.price === null) unpriced++;
    else {
      value += r.position.shares * r.price;
      pricedCost += r.position.cost;
    }
  }
  return { cost, value, gain: value - pricedCost, unpriced };
}

/** Lights in the order a reader scans them: red, amber, gray, green; then the biggest holdings. */
export function byUrgency<T extends { light: Light; value: number }>(a: T, b: T): number {
  const rank: Record<Light, number> = { red: 0, amber: 1, gray: 2, green: 3 };
  return rank[a.light] - rank[b.light] || b.value - a.value;
}
