// DCF maker: unlevered free cash flow (FCFF) model that the user fills in and changes.
// Pure functions shared by the server (defaults), the browser (live recalculation) and the
// tests, which check it against an independent reference (scripts/reference/dcf_reference.py).
//
// For each projected year t:
//   revenue_t = revenue_{t−1} × (1 + growth_t)
//   EBIT_t    = revenue_t × EBIT margin_t;  NOPAT_t = EBIT_t × (1 − tax rate)
//   FCFF_t    = NOPAT_t + D&A_t − capex_t − ΔNWC_t
//               (D&A and capex as % of revenue; ΔNWC as % of the change in revenue)
//   discounted at WACC to the middle of the year (mid-year convention) or to its end.
// Terminal value at the end of the last year: Gordon growth on FCFF, or an EV/EBITDA exit
// multiple, discounted to the end of the last year.
// Equity value = enterprise value − debt + cash; value per share = equity ÷ (market cap ÷ price).

export interface MakerBase {
  revenue0: number; // trailing 12 months
  marketCap: number;
  price: number;
  debt: number; // long + short term
  cash: number;
}

export interface MakerAssumptions {
  growth: number[]; // revenue growth for each projected year
  ebitMargin: number[];
  daPct: number[]; // D&A / revenue
  capexPct: number[]; // capex / revenue
  nwcPct: number[]; // change in net working capital / change in revenue
  taxRate: number;
  rf: number;
  beta: number;
  erp: number;
  costOfDebt: number; // pre-tax
  waccOverride: number | null; // when the user types a WACC directly
  terminal: "gordon" | "exit";
  terminalGrowth: number;
  exitMultiple: number; // EV / EBITDA in the last year
  midYear: boolean;
}

export type MakerIssue = "badRate" | "rateBelowGrowth" | "negativeTerminal" | "badInputs";

export interface MakerYear {
  t: number;
  revenue: number;
  ebit: number;
  nopat: number;
  da: number;
  capex: number;
  dNwc: number;
  fcff: number;
  ebitda: number;
  factor: number; // discount factor
  pv: number;
}

export interface MakerResult {
  costOfEquity: number;
  afterTaxCostOfDebt: number;
  weightEquity: number;
  weightDebt: number;
  wacc: number;
  years: MakerYear[];
  pvFlows: number;
  terminalValue: number;
  pvTerminal: number;
  ev: number;
  netDebt: number;
  equity: number;
  perShare: number;
  upside: number; // vs the current price
  terminalShare: number; // share of EV from the terminal value
  impliedExitMultiple: number; // what the terminal value means as EV/EBITDA
  impliedTerminalGrowth: number; // … and as perpetual growth
}

export function waccOf(base: MakerBase, a: MakerAssumptions) {
  const costOfEquity = a.rf + a.beta * a.erp;
  const afterTaxCostOfDebt = a.costOfDebt * (1 - a.taxRate);
  const d = Math.max(0, base.debt);
  const e = Math.max(0, base.marketCap);
  const weightDebt = d + e > 0 ? d / (d + e) : 0;
  const weightEquity = 1 - weightDebt;
  const wacc = a.waccOverride ?? weightEquity * costOfEquity + weightDebt * afterTaxCostOfDebt;
  return { costOfEquity, afterTaxCostOfDebt, weightEquity, weightDebt, wacc };
}

const finite = (xs: number[]) => xs.every((x) => Number.isFinite(x));

export function runDcf(base: MakerBase, a: MakerAssumptions): { ok: true; result: MakerResult } | { ok: false; issue: MakerIssue } {
  const n = a.growth.length;
  const arrays = [a.growth, a.ebitMargin, a.daPct, a.capexPct, a.nwcPct];
  if (n === 0 || arrays.some((x) => x.length !== n || !finite(x))) return { ok: false, issue: "badInputs" };
  if (![a.taxRate, a.rf, a.beta, a.erp, a.costOfDebt, a.terminalGrowth, a.exitMultiple].every(Number.isFinite)) return { ok: false, issue: "badInputs" };
  if (!(base.revenue0 > 0) || !(base.marketCap > 0) || !(base.price > 0)) return { ok: false, issue: "badInputs" };

  const w = waccOf(base, a);
  if (!(w.wacc > 0) || w.wacc >= 1) return { ok: false, issue: "badRate" };
  if (a.terminal === "gordon" && !(w.wacc > a.terminalGrowth)) return { ok: false, issue: "rateBelowGrowth" };

  const years: MakerYear[] = [];
  let prev = base.revenue0;
  let pvFlows = 0;
  for (let k = 0; k < n; k++) {
    const t = k + 1;
    const revenue = prev * (1 + a.growth[k]);
    const ebit = revenue * a.ebitMargin[k];
    const nopat = ebit * (1 - a.taxRate);
    const da = revenue * a.daPct[k];
    const capex = revenue * a.capexPct[k];
    const dNwc = (revenue - prev) * a.nwcPct[k];
    const fcff = nopat + da - capex - dNwc;
    const factor = 1 / (1 + w.wacc) ** (a.midYear ? t - 0.5 : t);
    const pv = fcff * factor;
    pvFlows += pv;
    years.push({ t, revenue, ebit, nopat, da, capex, dNwc, fcff, ebitda: ebit + da, factor, pv });
    prev = revenue;
  }
  const last = years[n - 1];
  const terminalValue =
    a.terminal === "gordon" ? (last.fcff * (1 + a.terminalGrowth)) / (w.wacc - a.terminalGrowth) : last.ebitda * a.exitMultiple;
  if (!(terminalValue > 0)) return { ok: false, issue: "negativeTerminal" };
  const pvTerminal = terminalValue / (1 + w.wacc) ** n;
  const ev = pvFlows + pvTerminal;
  const netDebt = base.debt - base.cash;
  const equity = ev - netDebt;
  const shares = base.marketCap / base.price;
  const perShare = equity / shares;
  return {
    ok: true,
    result: {
      ...w,
      years,
      pvFlows,
      terminalValue,
      pvTerminal,
      ev,
      netDebt,
      equity,
      perShare,
      upside: perShare / base.price - 1,
      terminalShare: pvTerminal / ev,
      impliedExitMultiple: last.ebitda > 0 ? terminalValue / last.ebitda : NaN,
      impliedTerminalGrowth: (terminalValue * w.wacc - last.fcff) / (terminalValue + last.fcff),
    },
  };
}

/**
 * The constant revenue growth (every projected year, keeping the user's other assumptions)
 * at which the model's value per share equals today's price. Bisection on −50 %…+100 %.
 */
export function impliedRevenueGrowth(base: MakerBase, a: MakerAssumptions): { g: number | null; bound: "below" | "above" | null } {
  const at = (g: number) => {
    const r = runDcf(base, { ...a, growth: a.growth.map(() => g) });
    return r.ok ? r.result.perShare : null;
  };
  let lo = -0.5;
  let hi = 1;
  const vLo = at(lo);
  const vHi = at(hi);
  if (vLo === null || vHi === null) return { g: null, bound: null };
  if (base.price < vLo) return { g: null, bound: "below" };
  if (base.price > vHi) return { g: null, bound: "above" };
  for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    const v = at(mid);
    if (v === null) return { g: null, bound: null };
    if (v < base.price) lo = mid;
    else hi = mid;
  }
  return { g: (lo + hi) / 2, bound: null };
}

/** Value per share for WACC × (terminal growth or exit multiple) around the current inputs. */
export function sensitivity(base: MakerBase, a: MakerAssumptions, waccSteps: number[], secondSteps: number[]) {
  const center = waccOf(base, a).wacc;
  return {
    waccs: waccSteps.map((d) => center + d),
    seconds: secondSteps.map((d) => (a.terminal === "gordon" ? a.terminalGrowth + d : a.exitMultiple + d)),
    grid: waccSteps.map((dw) =>
      secondSteps.map((ds) => {
        const r = runDcf(base, {
          ...a,
          waccOverride: center + dw,
          ...(a.terminal === "gordon" ? { terminalGrowth: a.terminalGrowth + ds } : { exitMultiple: a.exitMultiple + ds }),
        });
        return r.ok ? r.result.perShare : null;
      }),
    ),
  };
}

// ---- Defaults from the company's data ----------------------------------------------

/** Compound annual growth between two positive values `years` apart. */
export function cagr(from: number, to: number, years: number): number | null {
  if (!(from > 0) || !(to > 0) || !(years > 0)) return null;
  return (to / from) ** (1 / years) - 1;
}

export interface MakerData {
  revenue: number; // TTM
  ebit: number | null;
  da: number | null;
  capex: number | null;
  incomeTax: number | null;
  pretaxIncome: number | null;
  interestExpense: number | null;
  revenueCagr5: number | null;
  rf: number | null;
  erp: number | null;
  beta: number | null;
}

export const PROJECTION_YEARS = 5;
export const DEFAULT_TERMINAL_GROWTH = 0.025;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/**
 * Starting assumptions, each one traceable: growth fades from the 5-year revenue CAGR towards
 * terminal growth; margins and ratios are today's TTM figures; capex converges to D&A by the
 * last year (a steady state, with no heavy net investment forever); tax is the effective rate.
 * Where data is missing the default is a stated convention (see `conventions`).
 */
export function makerDefaults(d: MakerData, base: MakerBase): { assumptions: MakerAssumptions; conventions: string[] } {
  const conventions: string[] = [];
  const n = PROJECTION_YEARS;
  const gT = DEFAULT_TERMINAL_GROWTH;
  if (d.revenueCagr5 === null) conventions.push("growth");
  const g0 = clamp(d.revenueCagr5 ?? 0.03, -0.05, 0.25);
  const growth = Array.from({ length: n }, (_, k) => round4(g0 + ((gT - g0) * k) / n));
  const ratio = (x: number | null, key: string, fallback: number) => {
    if (x === null || !(d.revenue > 0)) {
      conventions.push(key);
      return fallback;
    }
    return round4(x / d.revenue);
  };
  // Companies that don't report operating income: EBIT ≈ pretax income + interest expense.
  let ebit = d.ebit;
  if (ebit === null && d.pretaxIncome !== null) {
    ebit = d.pretaxIncome + (d.interestExpense ?? 0);
    conventions.push("ebitFromPretax");
  }
  const margin = ratio(ebit, "ebitMargin", 0.1);
  const da = ratio(d.da, "daPct", 0.03);
  const capex0 = ratio(d.capex, "capexPct", 0.03);
  const capexPct = Array.from({ length: n }, (_, k) => round4(capex0 > da ? capex0 + ((da - capex0) * (k + 1)) / n : capex0));
  conventions.push("nwcPct"); // no working-capital history in the filings we read: 0 % until you change it
  let taxRate = 0.21;
  if (d.incomeTax !== null && d.pretaxIncome !== null && d.pretaxIncome > 0) taxRate = round4(clamp(d.incomeTax / d.pretaxIncome, 0, 0.35));
  else conventions.push("taxRate");
  if (d.rf === null) conventions.push("rf");
  if (d.erp === null) conventions.push("erp");
  if (d.beta === null) conventions.push("beta");
  const rf = d.rf ?? 0.045;
  let costOfDebt = round4(rf + 0.015);
  if (d.interestExpense !== null && d.interestExpense > 0 && base.debt > 0) costOfDebt = round4(clamp(d.interestExpense / base.debt, 0.01, 0.15));
  else conventions.push("costOfDebt");
  // Exit multiple: today's EV/EBITDA on the same TTM figures.
  const ebitda = ebit !== null && d.da !== null ? ebit + d.da : null;
  let exitMultiple = 10;
  if (ebitda !== null && ebitda > 0) {
    const evEbitda = (base.marketCap + base.debt - base.cash) / ebitda;
    exitMultiple = Math.round(clamp(evEbitda, 4, 40) * 2) / 2;
  } else conventions.push("exitMultiple");
  return {
    assumptions: {
      growth,
      ebitMargin: growth.map(() => margin),
      daPct: growth.map(() => da),
      capexPct,
      nwcPct: growth.map(() => 0),
      taxRate,
      rf,
      beta: d.beta !== null ? round4(d.beta) : 1,
      erp: d.erp ?? 0.05,
      costOfDebt,
      waccOverride: null,
      terminal: "gordon",
      terminalGrowth: gT,
      exitMultiple,
      midYear: true,
    },
    conventions,
  };
}
