// Discounted cash flow on free cash flow to equity. Pure functions shared by the server
// (defaults, reverse DCF) and the browser (editable scenarios).
//
// Model, shown to the user next to every result:
//  - Years 1–5 grow at g1; years 6–10 fade linearly from g1 to the terminal growth gT.
//  - Each year's free cash flow is discounted at the cost of equity r.
//  - Terminal value at year 10 = FCF₁₀ × (1 + gT) ÷ (r − gT), discounted 10 years.
//  - Equity value = sum of discounted flows + discounted terminal value.

export const YEARS = 10;
export const HIGH_GROWTH_YEARS = 5;

export interface DcfInput {
  fcf0: number; // trailing free cash flow (base year)
  r: number; // cost of equity, e.g. 0.093
  gT: number; // terminal growth
  g1: number; // growth for years 1–5
}

export type DcfIssue = "negativeFcf" | "rateBelowGrowth" | "badRate";

export function dcfIssue({ fcf0, r, gT }: Pick<DcfInput, "fcf0" | "r" | "gT">): DcfIssue | null {
  if (!(fcf0 > 0)) return "negativeFcf";
  if (!(r > 0) || r >= 1) return "badRate";
  if (!(r > gT)) return "rateBelowGrowth";
  return null;
}

/** Growth for each year 1..YEARS. */
export function growthPath(g1: number, gT: number): number[] {
  return Array.from({ length: YEARS }, (_, k) => {
    const t = k + 1;
    if (t <= HIGH_GROWTH_YEARS) return g1;
    return g1 + ((gT - g1) * (t - HIGH_GROWTH_YEARS)) / (YEARS - HIGH_GROWTH_YEARS);
  });
}

export interface DcfResult {
  value: number;
  pvFlows: number;
  pvTerminal: number;
  flows: number[]; // undiscounted FCF for years 1..YEARS
}

export function dcf({ fcf0, r, gT, g1 }: DcfInput): DcfResult {
  let fcf = fcf0;
  let pvFlows = 0;
  const flows: number[] = [];
  growthPath(g1, gT).forEach((g, k) => {
    fcf *= 1 + g;
    flows.push(fcf);
    pvFlows += fcf / (1 + r) ** (k + 1);
  });
  const terminal = (fcf * (1 + gT)) / (r - gT);
  const pvTerminal = terminal / (1 + r) ** YEARS;
  return { value: pvFlows + pvTerminal, pvFlows, pvTerminal, flows };
}

export const SEARCH_RANGE = { min: -0.5, max: 1 } as const;

/**
 * Growth for years 1–5 that makes the DCF equal `target` (the market value): what the
 * price "assumes". Value rises with g1, so bisection is exact to well under 0.01 %.
 */
export function impliedGrowth(input: Omit<DcfInput, "g1">, target: number): { g: number | null; bound: "below" | "above" | null } {
  const at = (g1: number) => dcf({ ...input, g1 }).value;
  let lo: number = SEARCH_RANGE.min;
  let hi: number = SEARCH_RANGE.max;
  if (target < at(lo)) return { g: null, bound: "below" };
  if (target > at(hi)) return { g: null, bound: "above" };
  for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < target) lo = mid;
    else hi = mid;
  }
  return { g: (lo + hi) / 2, bound: null };
}

/** Compound annual growth between two positive values `years` apart. */
export function cagr(from: number, to: number, years: number): number | null {
  if (!(from > 0) || !(to > 0) || !(years > 0)) return null;
  return (to / from) ** (1 / years) - 1;
}

export interface Scenarios {
  bear: number;
  base: number;
  bull: number;
}

/**
 * Default growth for years 1–5: the company's 5-year revenue CAGR, kept within −5 %…20 %
 * and rounded to 0.5 %; bear and bull are 5 points either side. Assumptions, not forecasts:
 * the user can change all of them.
 */
export function defaultScenarios(revenueCagr: number | null): Scenarios {
  const raw = revenueCagr ?? 0.03;
  const base = Math.round(Math.min(0.2, Math.max(-0.05, raw)) * 200) / 200;
  const clean = (x: number) => Math.round(x * 10_000) / 10_000; // no 0.004999… in the inputs
  return { bear: clean(Math.max(-0.1, base - 0.05)), base, bull: clean(base + 0.05) };
}

export const DEFAULT_TERMINAL_GROWTH = 0.025;
