// Financial statements from SEC XBRL "companyfacts" (public data).
//
// Rules, so every number can be traced and checked:
//  - Each line has an ordered list of us-gaap concepts; for each period the first concept
//    that has a value wins (companies switch tags over the years, e.g. Revenues →
//    RevenueFromContractWithCustomerExcludingAssessedTax after ASC 606).
//  - When several filings report the same period, the most recently filed value wins
//    (restatements), and the cell keeps that filing's accession number.
//  - Annual = 10-K facts covering ~1 year. Quarterly flow values come from 3-month facts
//    or, when a company only reports year-to-date (cash flow), from differences of
//    cumulative values; Q4 = fiscal year − 9-month YTD. Derived cells are flagged.

export type StatementKey = "income" | "balance" | "cashflow";
export type LineKey =
  | "revenue" | "costOfRevenue" | "grossProfit" | "operatingIncome" | "netIncome" | "epsDiluted" | "dilutedShares"
  | "cash" | "totalAssets" | "totalLiabilities" | "longTermDebt" | "equity"
  | "operatingCashFlow" | "capex" | "freeCashFlow" | "dividendsPaid" | "buybacks";

interface LineDef {
  key: LineKey;
  statement: StatementKey;
  kind: "flow" | "instant";
  unit: "USD" | "USD/shares" | "shares";
  concepts: string[];
  additive: boolean; // false: quarterly values are never derived by subtraction (per-share data)
}

export const LINES: LineDef[] = [
  { key: "revenue", statement: "income", kind: "flow", unit: "USD", additive: true, concepts: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueGoodsNet"] },
  { key: "costOfRevenue", statement: "income", kind: "flow", unit: "USD", additive: true, concepts: ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold", "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization"] },
  { key: "grossProfit", statement: "income", kind: "flow", unit: "USD", additive: true, concepts: ["GrossProfit"] },
  { key: "operatingIncome", statement: "income", kind: "flow", unit: "USD", additive: true, concepts: ["OperatingIncomeLoss"] },
  { key: "netIncome", statement: "income", kind: "flow", unit: "USD", additive: true, concepts: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"] },
  { key: "epsDiluted", statement: "income", kind: "flow", unit: "USD/shares", additive: false, concepts: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"] },
  { key: "dilutedShares", statement: "income", kind: "flow", unit: "shares", additive: false, concepts: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"] },
  { key: "cash", statement: "balance", kind: "instant", unit: "USD", additive: false, concepts: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"] },
  { key: "totalAssets", statement: "balance", kind: "instant", unit: "USD", additive: false, concepts: ["Assets"] },
  { key: "totalLiabilities", statement: "balance", kind: "instant", unit: "USD", additive: false, concepts: ["Liabilities"] },
  { key: "longTermDebt", statement: "balance", kind: "instant", unit: "USD", additive: false, concepts: ["LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations"] },
  { key: "equity", statement: "balance", kind: "instant", unit: "USD", additive: false, concepts: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"] },
  { key: "operatingCashFlow", statement: "cashflow", kind: "flow", unit: "USD", additive: true, concepts: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"] },
  { key: "capex", statement: "cashflow", kind: "flow", unit: "USD", additive: true, concepts: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"] },
  { key: "dividendsPaid", statement: "cashflow", kind: "flow", unit: "USD", additive: true, concepts: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"] },
  { key: "buybacks", statement: "cashflow", kind: "flow", unit: "USD", additive: true, concepts: ["PaymentsForRepurchaseOfCommonStock"] },
];

/** Derived line, computed from others: free cash flow = operating cash flow − capex. */
export const DERIVED: { key: LineKey; statement: StatementKey; formula: string }[] = [
  { key: "freeCashFlow", statement: "cashflow", formula: "operatingCashFlow - capex" },
];

export interface Cell {
  value: number | null;
  concept?: string;
  accn?: string; // SEC accession number of the filing the value comes from
  form?: string;
  derived?: "ytd_difference" | "fy_minus_9m" | "formula";
}

export interface Period {
  end: string; // YYYY-MM-DD
  start?: string;
  label: string; // "FY2025" or "Q2 FY2025"
  accn?: string; // first filing that reported this period
  form?: string;
  filed?: string;
}

export interface StatementSet {
  periods: Period[]; // oldest → newest
  lines: Partial<Record<LineKey, Cell[]>>;
}

export interface Financials {
  cik: number;
  entityName: string;
  annual: StatementSet;
  quarterly: StatementSet;
}

interface Fact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
}

type ConceptMap = Record<string, { units?: Record<string, Fact[]> }>;

const DAY = 86_400_000;
const days = (start: string | undefined, end: string) => (start ? (Date.parse(end) - Date.parse(start)) / DAY : 0);
const near = (a: string, b: string, tolDays = 7) => Math.abs(Date.parse(a) - Date.parse(b)) <= tolDays * DAY;
const isAnnualForm = (f: string) => f === "10-K" || f === "10-K/A" || f === "20-F" || f === "40-F";
const isQuarterForm = (f: string) => f === "10-Q" || f === "10-Q/A";
const isYear = (f: Fact) => { const d = days(f.start, f.end); return d >= 340 && d <= 380; };
const isQuarter = (f: Fact) => { const d = days(f.start, f.end); return d >= 80 && d <= 100; };

/** Facts for a concept in the given unit, valid values only. */
function factsOf(gaap: ConceptMap, concept: string, unit: string): Fact[] {
  const list = gaap[concept]?.units?.[unit];
  return Array.isArray(list) ? list.filter((f) => typeof f.val === "number" && Number.isFinite(f.val) && typeof f.end === "string") : [];
}

/** Latest-filed fact matching a predicate. */
function latest(facts: Fact[], pred: (f: Fact) => boolean): Fact | undefined {
  let best: Fact | undefined;
  for (const f of facts) if (pred(f) && (!best || f.filed > best.filed)) best = f;
  return best;
}

function cellFrom(f: Fact | undefined, concept: string): Cell | null {
  return f ? { value: f.val, concept, accn: f.accn, form: f.form } : null;
}

// ---- Annual ---------------------------------------------------------------

function annualPeriods(gaap: ConceptMap, maxYears: number): Period[] {
  const byEnd = new Map<string, Fact>(); // earliest 10-K reporting each fiscal-year end
  for (const line of LINES.filter((l) => l.key === "revenue" || l.key === "netIncome")) {
    for (const concept of line.concepts) {
      for (const f of factsOf(gaap, concept, "USD")) {
        if (!isAnnualForm(f.form) || !isYear(f)) continue;
        const prev = byEnd.get(f.end);
        if (!prev || f.filed < prev.filed) byEnd.set(f.end, f);
      }
    }
  }
  // Collapse ends a few days apart (52/53-week years can shift by a day across filings).
  const ends = [...byEnd.keys()].sort();
  const out: Period[] = [];
  for (const end of ends) {
    if (out.length && near(out[out.length - 1].end, end, 5)) continue;
    const f = byEnd.get(end)!;
    out.push({ end, start: f.start, label: `FY${end.slice(0, 4)}`, accn: f.accn, form: f.form, filed: f.filed });
  }
  return out.slice(-maxYears);
}

function annualCell(gaap: ConceptMap, line: LineDef, p: Period): Cell {
  for (const concept of line.concepts) {
    const facts = factsOf(gaap, concept, line.unit);
    const f =
      line.kind === "instant"
        ? latest(facts, (x) => !x.start && near(x.end, p.end, 3) && (isAnnualForm(x.form) || isQuarterForm(x.form)))
        : latest(facts, (x) => isAnnualForm(x.form) && isYear(x) && near(x.end, p.end, 3));
    const c = cellFrom(f, concept);
    if (c) return c;
  }
  return { value: null };
}

// ---- Quarterly ------------------------------------------------------------

/** Quarter ends inside each fiscal year, plus the fiscal year end itself (Q4). */
function quarterPeriods(gaap: ConceptMap, years: Period[], maxQuarters: number): Period[] {
  const out: Period[] = [];
  for (const fy of years) {
    if (!fy.start) continue;
    const ends = new Map<string, Fact>();
    for (const line of LINES.filter((l) => l.key === "revenue" || l.key === "netIncome")) {
      for (const concept of line.concepts) {
        for (const f of factsOf(gaap, concept, "USD")) {
          if (!isQuarterForm(f.form) || !f.start) continue;
          const inside = Date.parse(f.end) > Date.parse(fy.start) + 60 * DAY && Date.parse(f.end) < Date.parse(fy.end) - 30 * DAY;
          if (!inside || (!isQuarter(f) && !near(f.start, fy.start))) continue;
          const key = [...ends.keys()].find((e) => near(e, f.end, 5)) ?? f.end;
          const prev = ends.get(key);
          if (!prev || f.filed < prev.filed) ends.set(key, f);
        }
      }
    }
    const qEnds = [...ends.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, 3);
    qEnds.forEach(([end, f], i) =>
      out.push({ end, label: `Q${i + 1} ${fy.label}`, accn: f.accn, form: f.form, filed: f.filed }),
    );
    if (qEnds.length === 3) out.push({ end: fy.end, label: `Q4 ${fy.label}`, accn: fy.accn, form: fy.form, filed: fy.filed });
  }
  // Quarter starts are the previous quarter end (or the fiscal year start for Q1).
  for (let i = 0; i < out.length; i++) {
    const fy = years.find((y) => out[i].label.endsWith(y.label));
    out[i].start = out[i].label.startsWith("Q1") ? fy?.start : out[i - 1]?.end;
  }
  return out.slice(-maxQuarters);
}

function quarterCell(gaap: ConceptMap, line: LineDef, q: Period, years: Period[]): Cell {
  const fy = years.find((y) => q.label.endsWith(y.label));
  for (const concept of line.concepts) {
    const facts = factsOf(gaap, concept, line.unit);
    if (facts.length === 0) continue;

    if (line.kind === "instant") {
      const c = cellFrom(latest(facts, (x) => !x.start && near(x.end, q.end, 3)), concept);
      if (c) return c;
      continue;
    }

    // 1) A reported 3-month value.
    const direct = latest(facts, (x) => isQuarter(x) && near(x.end, q.end, 3) && (isQuarterForm(x.form) || isAnnualForm(x.form)));
    if (direct) return cellFrom(direct, concept)!;
    if (!line.additive || !fy?.start) continue;

    // 2) Year-to-date at this quarter end minus year-to-date at the previous one.
    const ytd = (end: string) =>
      latest(facts, (x) => !!x.start && near(x.start, fy.start!, 7) && near(x.end, end, 3));
    const cur = q.label.startsWith("Q4")
      ? latest(facts, (x) => isAnnualForm(x.form) && isYear(x) && near(x.end, fy.end, 3))
      : ytd(q.end);
    if (!cur) continue;
    if (q.label.startsWith("Q1")) return cellFrom(cur, concept)!;
    const prev = q.start ? ytd(q.start) : undefined;
    if (!prev) continue;
    return {
      value: cur.val - prev.val,
      concept,
      accn: cur.accn,
      form: cur.form,
      derived: q.label.startsWith("Q4") ? "fy_minus_9m" : "ytd_difference",
    };
  }
  return { value: null };
}

// ---- Assembly -------------------------------------------------------------

function addDerived(set: StatementSet) {
  const ocf = set.lines.operatingCashFlow;
  const capex = set.lines.capex;
  if (!ocf || !capex) return;
  set.lines.freeCashFlow = ocf.map((c, i) => {
    const cx = capex[i];
    return c.value !== null && cx?.value != null ? { value: c.value - cx.value, derived: "formula" as const } : { value: null };
  });
}

function dropEmptyLines(set: StatementSet) {
  for (const [k, cells] of Object.entries(set.lines)) {
    if (!cells || cells.every((c) => c.value === null)) delete set.lines[k as LineKey];
  }
}

export function parseCompanyFacts(json: unknown, opts: { years?: number; quarters?: number } = {}): Financials {
  if (!json || typeof json !== "object") throw new Error("sec: unexpected companyfacts payload");
  const root = json as { cik?: unknown; entityName?: unknown; facts?: { "us-gaap"?: ConceptMap } };
  const gaap = root.facts?.["us-gaap"];
  if (!gaap) throw new Error("sec: no us-gaap facts");

  const years = annualPeriods(gaap, opts.years ?? 15);
  const allYears = annualPeriods(gaap, 100); // quarter derivation needs the fiscal-year bounds
  const quarters = quarterPeriods(gaap, allYears, opts.quarters ?? 16);

  const annual: StatementSet = { periods: years, lines: {} };
  const quarterly: StatementSet = { periods: quarters, lines: {} };
  for (const line of LINES) {
    annual.lines[line.key] = years.map((p) => annualCell(gaap, line, p));
    quarterly.lines[line.key] = quarters.map((q) => quarterCell(gaap, line, q, allYears));
  }
  for (const set of [annual, quarterly]) {
    addDerived(set);
    dropEmptyLines(set);
  }
  return {
    cik: Number(root.cik),
    entityName: typeof root.entityName === "string" ? root.entityName : "",
    annual,
    quarterly,
  };
}

/** Link to the filing index on EDGAR for a cell's accession number. */
export function filingUrl(cik: number, accn: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}/${accn}-index.htm`;
}

export function companyFactsUrl(cik: number): string {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
}
