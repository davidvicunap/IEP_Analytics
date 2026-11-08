// Comparable companies ("comps"). Pure functions: the browser recomputes everything when the
// user adds or removes a peer or types a market cap the data plan doesn't provide.
//
// Everyone is measured on the same basis: the same fiscal year of SEC data (frames) and a
// current market cap. Enterprise value = market cap + debt (long and short term) − cash.
import { median } from "./ratios";
import type { RatioInputs } from "./ratios";

export type CompsMultiple = "evSales" | "evEbitda" | "pe" | "pb" | "fcfYield";
export const COMPS_MULTIPLES: CompsMultiple[] = ["evSales", "evEbitda", "pe", "pb", "fcfYield"];

export interface CompsCompany {
  symbol: string;
  name: string;
  marketCap: number | null;
  marketCapSource: "market" | "manual" | null; // market = data provider; manual = typed by the user
  inputs: RatioInputs | null; // fiscal-year SEC figures
}

export interface CompsRow extends CompsCompany {
  ev: number | null;
  netDebt: number | null;
  ebitda: number | null;
  fcf: number | null;
  multiples: Record<CompsMultiple, number | null>;
  growth: number | null; // revenue growth on the year
  operatingMargin: number | null;
  netMargin: number | null;
}

const pos = (v: number | undefined | null) => (v !== undefined && v !== null && v > 0 ? v : null);
const has = (v: number | undefined | null): v is number => v !== undefined && v !== null && Number.isFinite(v);

export function netDebtOf(i: RatioInputs): number | null {
  if (!has(i.cash)) return null; // without cash the bridge would overstate EV
  return (i.longTermDebt ?? 0) + (i.currentDebt ?? 0) - i.cash;
}

export function compsRow(c: CompsCompany): CompsRow {
  const i = c.inputs ?? {};
  const mc = pos(c.marketCap);
  const nd = c.inputs ? netDebtOf(i) : null;
  const ev = mc !== null && nd !== null ? mc + nd : null;
  const revenue = i.revenueAmbiguous ? null : pos(i.revenue);
  const ebitda = has(i.operatingIncome) && has(i.depreciation) ? i.operatingIncome + i.depreciation : null;
  const fcf = has(i.ocf) && has(i.capex) ? i.ocf - i.capex : null;
  return {
    ...c,
    ev,
    netDebt: nd,
    ebitda,
    fcf,
    multiples: {
      evSales: ev !== null && revenue ? ev / revenue : null,
      evEbitda: ev !== null && pos(ebitda) ? ev / ebitda! : null,
      pe: mc !== null && pos(i.netIncome) ? mc / i.netIncome! : null,
      pb: mc !== null && pos(i.equity) ? mc / i.equity! : null,
      fcfYield: mc !== null && fcf !== null ? fcf / mc : null,
    },
    growth: revenue && pos(i.revenuePrev) ? revenue / i.revenuePrev! - 1 : null,
    operatingMargin: revenue && has(i.operatingIncome) ? i.operatingIncome / revenue : null,
    netMargin: revenue && has(i.netIncome) ? i.netIncome / revenue : null,
  };
}

/** Linear-interpolated quantile (same convention as spreadsheets' PERCENTILE.INC). */
export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export interface Stats {
  n: number;
  low: number; // 25th percentile
  median: number;
  mean: number;
  high: number; // 75th percentile
}

export function peerStats(rows: CompsRow[], m: CompsMultiple): Stats | null {
  const v = rows.map((r) => r.multiples[m]).filter((x): x is number => x !== null);
  if (v.length === 0) return null;
  return {
    n: v.length,
    low: quantile(v, 0.25)!,
    median: median(v)!,
    mean: v.reduce((a, b) => a + b, 0) / v.length,
    high: quantile(v, 0.75)!,
  };
}

export interface ImpliedRange {
  multiple: CompsMultiple;
  low: number; // per share
  mid: number;
  high: number;
  basis: number; // the target's metric the multiple is applied to
}

/**
 * Price per share implied by applying the peers' multiples to the target. EV multiples go
 * through the net-debt bridge; yields are inverted (a higher peer yield means a lower value).
 * `stat` picks the central value: median (default) or mean.
 */
export function impliedValues(
  target: CompsRow,
  peers: CompsRow[],
  price: number,
  stat: "median" | "mean" = "median",
): ImpliedRange[] {
  const mc = pos(target.marketCap);
  if (!mc || !(price > 0)) return [];
  const shares = mc / price;
  const i = target.inputs ?? {};
  const out: ImpliedRange[] = [];
  for (const m of COMPS_MULTIPLES) {
    const s = peerStats(peers, m);
    if (!s) continue;
    const center = stat === "mean" ? s.mean : s.median;
    let perShare: ((x: number) => number | null) | null = null;
    let basis: number | null = null;
    if (m === "evSales" || m === "evEbitda") {
      basis = m === "evSales" ? (i.revenueAmbiguous ? null : pos(i.revenue)) : pos(target.ebitda);
      if (basis !== null && target.netDebt !== null) perShare = (x) => (x * basis! - target.netDebt!) / shares;
    } else if (m === "pe" || m === "pb") {
      basis = m === "pe" ? pos(i.netIncome) : pos(i.equity);
      if (basis !== null) perShare = (x) => (x * basis!) / shares;
    } else {
      basis = pos(target.fcf);
      if (basis !== null) perShare = (x) => (x > 0 ? basis! / x / shares : null);
    }
    if (!perShare || basis === null) continue;
    const a = perShare(s.low);
    const b = perShare(center);
    const c = perShare(s.high);
    if (a === null || b === null || c === null) continue;
    out.push({ multiple: m, low: Math.min(a, c), mid: b, high: Math.max(a, c), basis });
  }
  return out;
}
