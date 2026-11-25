// Each company's key figures per fiscal year or quarter, built from its SEC statements (split-
// adjusted per-share figures): the inputs of the quarter in review. Pure, no I/O.
import { splitFactors } from "./quality";
import { TAX_RATE } from "./ratios";
import type { LineKey, SharesHistory, StatementSet } from "./secFinancials";

export type FundamentalKey =
  | "revenue" | "grossProfit" | "operatingIncome" | "ebitda" | "netIncome"
  | "operatingCashFlow" | "capex" | "freeCashFlow" | "dividendsPaid" | "buybacks"
  | "cash" | "debt" | "equity" | "totalAssets"
  | "eps" | "fcfPerShare" | "bookValuePerShare" | "dividendsPerShare"
  | "grossMargin" | "operatingMargin" | "netMargin" | "fcfMargin"
  | "roe" | "roa" | "roic" | "debtToEquity" | "shares";

/** Every figure, in display order. */
export const FUNDAMENTAL_KEYS: FundamentalKey[] = [
  "revenue",
  "grossProfit",
  "operatingIncome",
  "ebitda",
  "netIncome",
  "operatingCashFlow",
  "capex",
  "freeCashFlow",
  "dividendsPaid",
  "buybacks",
  "cash",
  "debt",
  "equity",
  "totalAssets",
  "shares",
  "eps",
  "fcfPerShare",
  "bookValuePerShare",
  "dividendsPerShare",
  "grossMargin",
  "operatingMargin",
  "netMargin",
  "fcfMargin",
  "roe",
  "roa",
  "roic",
  "debtToEquity",
];

/** One company's values for one frequency: `keys` sort chronologically and align across companies. */
export interface PeriodSeries {
  keys: string[]; // "FY2024" (fiscal year) · "2024-Q3" (calendar quarter)
  ends: string[]; // period end dates (YYYY-MM-DD)
  values: Partial<Record<FundamentalKey, (number | null)[]>>;
}

/** Calendar quarter of a period end ("2024-Q3"). Ends a few days into a month count for the month before. */
export function calendarQuarter(end: string): string {
  const d = new Date(Date.parse(end) - 10 * 86_400_000);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

const nonNeg = (x: number | null) => (x === null ? null : Math.abs(x));
const ratio = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? a / b : null);

/** Every fundamental metric for every period of a statement set, per-share figures split-adjusted. */
export function fundamentalSeries(set: StatementSet, splits: SharesHistory["splits"], freq: "annual" | "quarterly"): PeriodSeries {
  const f = splitFactors(set, splits);
  const v = (k: LineKey, i: number) => {
    const x = set.lines[k]?.[i]?.value;
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  };
  const out: Record<FundamentalKey, (number | null)[]> = Object.fromEntries(
    FUNDAMENTAL_KEYS.map((k) => [k, []]),
  ) as unknown as Record<FundamentalKey, (number | null)[]>;
  const keys: string[] = [];
  const ends: string[] = [];
  const seen = new Set<string>();
  set.periods.forEach((p, i) => {
    const key = freq === "annual" ? p.label : calendarQuarter(p.end);
    if (seen.has(key)) return; // two periods in one calendar quarter: keep the first
    seen.add(key);
    keys.push(key);
    ends.push(p.end);
    const revenue = v("revenue", i);
    const cost = v("costOfRevenue", i);
    const gross = v("grossProfit", i) ?? (revenue !== null && cost !== null ? revenue - cost : null);
    const op = v("operatingIncome", i);
    const ni = v("netIncome", i);
    const dep = v("depreciation", i);
    const ocf = v("operatingCashFlow", i);
    const capex = nonNeg(v("capex", i));
    const fcf = v("freeCashFlow", i) ?? (ocf !== null && capex !== null ? ocf - capex : null);
    const ltd = v("longTermDebt", i);
    const std = v("currentDebt", i);
    const debt = ltd === null && std === null ? null : (ltd ?? 0) + (std ?? 0);
    const equity = v("equity", i);
    const assets = v("totalAssets", i);
    const rawShares = v("dilutedShares", i);
    const shares = rawShares === null ? null : rawShares * f[i];
    const rawEps = v("epsDiluted", i);
    const divs = nonNeg(v("dividendsPaid", i));
    const row: Record<FundamentalKey, number | null> = {
      revenue,
      grossProfit: gross,
      operatingIncome: op,
      ebitda: op !== null && dep !== null ? op + dep : null,
      netIncome: ni,
      operatingCashFlow: ocf,
      capex,
      freeCashFlow: fcf,
      dividendsPaid: divs,
      buybacks: nonNeg(v("buybacks", i)),
      cash: v("cash", i),
      debt,
      equity,
      totalAssets: assets,
      shares,
      eps: rawEps === null ? null : rawEps / f[i],
      fcfPerShare: ratio(fcf, shares),
      bookValuePerShare: ratio(equity, shares),
      dividendsPerShare: ratio(divs, shares),
      grossMargin: ratio(gross, revenue),
      operatingMargin: ratio(op, revenue),
      netMargin: ratio(ni, revenue),
      fcfMargin: ratio(fcf, revenue),
      roe: freq === "annual" ? ratio(ni, equity) : null,
      roa: freq === "annual" ? ratio(ni, assets) : null,
      roic: freq === "annual" && op !== null && equity !== null && ltd !== null ? ratio(op * (1 - TAX_RATE), equity + ltd) : null,
      debtToEquity: ratio(debt, equity),
    };
    for (const k of Object.keys(out) as FundamentalKey[]) out[k].push(row[k]);
  });
  return { keys, ends, values: out };
}
