// Financial ratios with context: the same formulas run on a company's own history (from its
// SEC statements) and on its peers (SEC frames), so percentiles compare like with like.
import type { StatementSet } from "./secFinancials";

export type RatioKey =
  | "grossMargin" | "operatingMargin" | "netMargin" | "fcfMargin"
  | "roe" | "roa" | "roic"
  | "debtToEquity" | "equityToAssets"
  | "revenueGrowth" | "epsGrowth";

export type RatioGroup = "profitability" | "returns" | "health" | "growth";
export type BusinessType = "general" | "bank" | "insurance" | "reit";
export type RatioNote = "negativeEquity" | "smallEquity" | "negativeBase";

/** Raw annual figures a ratio needs. Balance-sheet values are at the period end. */
export interface RatioInputs {
  revenue?: number;
  revenuePrev?: number;
  grossProfit?: number;
  costOfRevenue?: number;
  operatingIncome?: number;
  netIncome?: number;
  eps?: number;
  epsPrev?: number;
  ocf?: number;
  capex?: number;
  equity?: number;
  assets?: number;
  longTermDebt?: number;
}
export const INPUT_KEYS: (keyof RatioInputs)[] = [
  "revenue", "revenuePrev", "grossProfit", "costOfRevenue", "operatingIncome", "netIncome",
  "eps", "epsPrev", "ocf", "capex", "equity", "assets", "longTermDebt",
];

/** US federal statutory rate, used to put operating income on an after-tax basis for ROIC. */
export const TAX_RATE = 0.21;

interface RatioDef {
  key: RatioKey;
  group: RatioGroup;
  better: "higher" | "lower";
  appliesTo: BusinessType[];
  compute: (i: RatioInputs) => number | null;
}

const ALL: BusinessType[] = ["general", "bank", "insurance", "reit"];
const NON_FIN: BusinessType[] = ["general", "reit"];
const ok = (...v: (number | undefined)[]) => v.every((x) => typeof x === "number" && Number.isFinite(x));
const div = (a: number | undefined, b: number | undefined, positiveBase = true) =>
  ok(a, b) && (positiveBase ? b! > 0 : b !== 0) ? a! / b! : null;

export const RATIOS: RatioDef[] = [
  {
    key: "grossMargin", group: "profitability", better: "higher", appliesTo: ["general"],
    compute: (i) => div(i.grossProfit ?? (ok(i.revenue, i.costOfRevenue) ? i.revenue! - i.costOfRevenue! : undefined), i.revenue),
  },
  { key: "operatingMargin", group: "profitability", better: "higher", appliesTo: NON_FIN, compute: (i) => div(i.operatingIncome, i.revenue) },
  { key: "netMargin", group: "profitability", better: "higher", appliesTo: ALL, compute: (i) => div(i.netIncome, i.revenue) },
  {
    key: "fcfMargin", group: "profitability", better: "higher", appliesTo: NON_FIN,
    compute: (i) => (ok(i.ocf, i.capex) ? div(i.ocf! - i.capex!, i.revenue) : null),
  },
  { key: "roe", group: "returns", better: "higher", appliesTo: ALL, compute: (i) => div(i.netIncome, i.equity) },
  { key: "roa", group: "returns", better: "higher", appliesTo: ALL, compute: (i) => div(i.netIncome, i.assets) },
  {
    key: "roic", group: "returns", better: "higher", appliesTo: ["general"],
    compute: (i) => (ok(i.operatingIncome, i.equity, i.longTermDebt) ? div(i.operatingIncome! * (1 - TAX_RATE), i.equity! + i.longTermDebt!) : null),
  },
  { key: "debtToEquity", group: "health", better: "lower", appliesTo: NON_FIN, compute: (i) => div(i.longTermDebt, i.equity) },
  { key: "equityToAssets", group: "health", better: "higher", appliesTo: ["bank", "insurance"], compute: (i) => div(i.equity, i.assets) },
  { key: "revenueGrowth", group: "growth", better: "higher", appliesTo: ALL, compute: (i) => (ok(i.revenue) ? (div(i.revenue, i.revenuePrev) ?? NaN) - 1 : null) },
  { key: "epsGrowth", group: "growth", better: "higher", appliesTo: ALL, compute: (i) => (ok(i.eps) ? (div(i.eps, i.epsPrev) ?? NaN) - 1 : null) },
];

/** Every ratio for one period; null when an input is missing or the base is zero/negative. */
export function computeRatios(i: RatioInputs): Record<RatioKey, number | null> {
  const out = {} as Record<RatioKey, number | null>;
  for (const r of RATIOS) {
    const v = r.compute(i);
    out[r.key] = v !== null && Number.isFinite(v) ? v : null;
  }
  return out;
}

/** Why a ratio is missing or needs care, so the UI can say it instead of showing a bare dash. */
export function ratioNote(key: RatioKey, i: RatioInputs, type: BusinessType): RatioNote | null {
  const equityBased = key === "roe" || key === "debtToEquity" || key === "roic";
  if (equityBased && ok(i.equity) && i.equity! <= 0) return "negativeEquity";
  if (key === "roe" && type === "general" && ok(i.equity, i.assets) && i.assets! > 0 && i.equity! > 0 && i.equity! / i.assets! < 0.1) {
    return "smallEquity"; // buybacks shrink equity and inflate ROE
  }
  if (key === "revenueGrowth" && ok(i.revenuePrev) && i.revenuePrev! <= 0) return "negativeBase";
  if (key === "epsGrowth" && ok(i.epsPrev) && i.epsPrev! <= 0) return "negativeBase";
  return null;
}

/** SIC ranges with their own metric sets (CFA review: banks, insurers and REITs differ). */
export function businessType(sic: number | null | undefined): BusinessType {
  if (!sic) return "general";
  if ((sic >= 6000 && sic <= 6199) || sic === 6211) return "bank";
  if (sic >= 6300 && sic <= 6411) return "insurance";
  if (sic === 6798) return "reit";
  return "general";
}

export const applies = (key: RatioKey, type: BusinessType) => RATIOS.find((r) => r.key === key)!.appliesTo.includes(type);

/** Percentile rank 0–100: share of values below x, counting ties as half. */
export function percentileRank(values: number[], x: number): number | null {
  if (values.length === 0) return null;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < x) below++;
    else if (v === x) equal++;
  }
  return Math.round(((below + equal / 2) / values.length) * 100);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const DAY = 86_400_000;
const yearApart = (a: string, b: string) => Math.abs(Date.parse(b) - Date.parse(a) - 365 * DAY) <= 20 * DAY;

/** Per-period inputs from annual statements; "previous" values only from the year right before. */
export function inputsFromStatements(set: StatementSet): RatioInputs[] {
  const v = (key: keyof StatementSet["lines"], i: number) => set.lines[key]?.[i]?.value ?? undefined;
  return set.periods.map((p, i) => {
    const prevOk = i > 0 && yearApart(set.periods[i - 1].end, p.end);
    const inputs: RatioInputs = {
      revenue: v("revenue", i),
      revenuePrev: prevOk ? v("revenue", i - 1) : undefined,
      grossProfit: v("grossProfit", i),
      costOfRevenue: v("costOfRevenue", i),
      operatingIncome: v("operatingIncome", i),
      netIncome: v("netIncome", i),
      eps: v("epsDiluted", i),
      epsPrev: prevOk ? v("epsDiluted", i - 1) : undefined,
      ocf: v("operatingCashFlow", i),
      capex: v("capex", i),
      equity: v("equity", i),
      assets: v("totalAssets", i),
      longTermDebt: v("longTermDebt", i),
    };
    for (const k of INPUT_KEYS) if (inputs[k] === undefined) delete inputs[k];
    return inputs;
  });
}
