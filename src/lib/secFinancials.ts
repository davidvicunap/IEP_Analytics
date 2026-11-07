// Financial statements from SEC XBRL "companyfacts" (public data).
//
// Rules, so every number can be traced and checked:
//  - Each line has an ordered list of us-gaap concepts; for each period the first concept
//    that has a value wins (companies switch tags over the years, e.g. Revenues →
//    RevenueFromContractWithCustomerExcludingAssessedTax after ASC 606).
//  - Revenue is different: many filers tag a partial figure with one revenue concept
//    (e.g. only revenue from contracts with customers, without interest, leases or
//    commodity sales) and the total with another. The largest candidate wins, and when
//    another candidate differs by more than 2 % the cell keeps it as `alt` so the UI can
//    say so and peer statistics can leave the company out.
//  - When several filings report the same period, the most recently filed value wins
//    (restatements), and the cell keeps that filing's accession number.
//  - Annual = 10-K facts covering ~1 year. Quarterly flow values come from 3-month facts
//    or, when a company only reports year-to-date (cash flow), from differences of
//    cumulative values; Q4 = fiscal year − 9-month YTD. Derived cells are flagged.

export type StatementKey = "income" | "balance" | "cashflow";
export type LineKey =
  | "revenue" | "costOfRevenue" | "grossProfit" | "operatingIncome" | "interestExpense" | "pretaxIncome" | "incomeTax"
  | "netIncome" | "epsDiluted" | "dilutedShares"
  | "cash" | "totalAssets" | "totalLiabilities" | "currentDebt" | "longTermDebt" | "equity"
  | "operatingCashFlow" | "depreciation" | "capex" | "freeCashFlow" | "dividendsPaid" | "buybacks";

interface LineDef {
  key: LineKey;
  statement: StatementKey;
  kind: "flow" | "instant";
  unit: "USD" | "USD/shares" | "shares";
  concepts: string[];
  additive: boolean; // false: quarterly values are never derived by subtraction (per-share data)
  largest?: boolean; // pick the largest candidate instead of the first (revenue)
  fallback?: string[]; // used only when no concept in `concepts` has a value
}

/** Two revenue totals further apart than this are flagged as ambiguous. */
export const ALT_TOLERANCE = 0.02;

export const LINES: LineDef[] = [
  {
    key: "revenue", statement: "income", kind: "flow", unit: "USD", additive: true, largest: true,
    concepts: ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenuesNetOfInterestExpense", "Revenues", "SalesRevenueNet"],
    // Only when nothing above is tagged: the first includes excise taxes collected for the
    // government, the second covers goods only (services are tagged separately).
    fallback: ["RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueGoodsNet"],
  },
  { key: "costOfRevenue", statement: "income", kind: "flow", unit: "USD", additive: true, concepts: ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold", "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization"] },
  { key: "grossProfit", statement: "income", kind: "flow", unit: "USD", additive: true, concepts: ["GrossProfit"] },
  { key: "operatingIncome", statement: "income", kind: "flow", unit: "USD", additive: true, concepts: ["OperatingIncomeLoss"] },
  { key: "interestExpense", statement: "income", kind: "flow", unit: "USD", additive: true, concepts: ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "InterestAndDebtExpense"] },
  {
    key: "pretaxIncome", statement: "income", kind: "flow", unit: "USD", additive: true,
    concepts: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
  },
  { key: "incomeTax", statement: "income", kind: "flow", unit: "USD", additive: true, concepts: ["IncomeTaxExpenseBenefit"] },
  { key: "netIncome", statement: "income", kind: "flow", unit: "USD", additive: true, concepts: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"] },
  { key: "epsDiluted", statement: "income", kind: "flow", unit: "USD/shares", additive: false, concepts: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"] },
  { key: "dilutedShares", statement: "income", kind: "flow", unit: "shares", additive: false, concepts: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"] },
  { key: "cash", statement: "balance", kind: "instant", unit: "USD", additive: false, concepts: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"] },
  { key: "totalAssets", statement: "balance", kind: "instant", unit: "USD", additive: false, concepts: ["Assets"] },
  { key: "totalLiabilities", statement: "balance", kind: "instant", unit: "USD", additive: false, concepts: ["Liabilities"] },
  // Debt due within a year: the total when tagged, otherwise its usual largest part.
  { key: "currentDebt", statement: "balance", kind: "instant", unit: "USD", additive: false, concepts: ["DebtCurrent", "LongTermDebtCurrent", "ShortTermBorrowings", "CommercialPaper"] },
  { key: "longTermDebt", statement: "balance", kind: "instant", unit: "USD", additive: false, concepts: ["LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations"] },
  { key: "equity", statement: "balance", kind: "instant", unit: "USD", additive: false, concepts: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"] },
  { key: "operatingCashFlow", statement: "cashflow", kind: "flow", unit: "USD", additive: true, concepts: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"] },
  {
    key: "depreciation", statement: "cashflow", kind: "flow", unit: "USD", additive: true,
    concepts: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization", "Depreciation"],
  },
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
  alt?: { concept: string; value: number }; // another total the SEC data has for this period
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
  shares: SharesHistory;
}

/** Shares outstanding from each report's cover page (dei:EntityCommonStockSharesOutstanding). */
export interface SharePoint {
  end: string; // the date the count refers to
  value: number; // as reported (not adjusted for later splits)
  filed: string;
}

/** A split detected between two cover-page counts: `ratio` new shares per old share. */
export interface Split {
  after: string; // last count before the split
  before: string; // first count after it
  ratio: number; // 4 for a 4-for-1 split, 0.1 for a 1-for-10 reverse split
}

export interface SharesHistory {
  points: SharePoint[];
  splits: Split[];
  /** First count after a jump that isn't a clean split (merger, data error): history starts there. */
  reliableFrom: string | null;
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

/** First concept with a value, or for `largest` lines the largest candidate (see header). */
export function pickCell(line: Pick<LineDef, "concepts" | "largest" | "fallback">, cellFor: (concept: string) => Cell | null): Cell {
  const first = (concepts: string[]) => {
    for (const concept of concepts) {
      const c = cellFor(concept);
      if (c && c.value !== null) return c;
    }
    return null;
  };
  if (!line.largest) return first([...line.concepts, ...(line.fallback ?? [])]) ?? { value: null };

  const cands = line.concepts.map(cellFor).filter((c): c is Cell => c !== null && c.value !== null);
  if (cands.length === 0) return first(line.fallback ?? []) ?? { value: null };
  let best = cands[0];
  for (const c of cands) if (c.value! > best.value!) best = c; // ties keep the earlier concept
  const others = cands.filter(
    (c) => c !== best && c.value! > 0 && Math.abs(best.value! - c.value!) > Math.abs(best.value!) * ALT_TOLERANCE,
  );
  if (others.length === 0) return best;
  const alt = others.reduce((a, b) => (a.value! < b.value! ? a : b));
  return { ...best, alt: { concept: alt.concept!, value: alt.value! } };
}

function annualCell(gaap: ConceptMap, line: LineDef, p: Period): Cell {
  return pickCell(line, (concept) => {
    const facts = factsOf(gaap, concept, line.unit);
    const f =
      line.kind === "instant"
        ? latest(facts, (x) => !x.start && near(x.end, p.end, 3) && (isAnnualForm(x.form) || isQuarterForm(x.form)))
        : latest(facts, (x) => isAnnualForm(x.form) && isYear(x) && near(x.end, p.end, 3));
    return cellFrom(f, concept);
  });
}

// ---- Quarterly ------------------------------------------------------------

/** The fiscal year after the last 10-K, still in progress: its quarters come from 10-Qs only. */
function openYear(years: Period[]): Period | null {
  const last = years[years.length - 1];
  if (!last) return null;
  const start = new Date(Date.parse(last.end) + DAY).toISOString().slice(0, 10);
  const end = new Date(Date.parse(last.end) + 365 * DAY).toISOString().slice(0, 10);
  return { start, end, label: `FY${end.slice(0, 4)}` };
}

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
    // Q4 comes from the 10-K, so the fiscal year in progress has no Q4 yet.
    if (qEnds.length === 3 && fy.accn) out.push({ end: fy.end, label: `Q4 ${fy.label}`, accn: fy.accn, form: fy.form, filed: fy.filed });
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
  // Each concept is resolved on its own, so a derived value never mixes two concepts.
  return pickCell(line, (concept): Cell | null => {
    const facts = factsOf(gaap, concept, line.unit);
    if (facts.length === 0) return null;

    if (line.kind === "instant") return cellFrom(latest(facts, (x) => !x.start && near(x.end, q.end, 3)), concept);

    // 1) A reported 3-month value.
    const direct = latest(facts, (x) => isQuarter(x) && near(x.end, q.end, 3) && (isQuarterForm(x.form) || isAnnualForm(x.form)));
    if (direct) return cellFrom(direct, concept);
    if (!line.additive || !fy?.start) return null;

    // 2) Year-to-date at this quarter end minus year-to-date at the previous one.
    const ytd = (end: string) =>
      latest(facts, (x) => !!x.start && near(x.start, fy.start!, 7) && near(x.end, end, 3));
    const cur = q.label.startsWith("Q4")
      ? latest(facts, (x) => isAnnualForm(x.form) && isYear(x) && near(x.end, fy.end, 3))
      : ytd(q.end);
    if (!cur) return null;
    if (q.label.startsWith("Q1")) return cellFrom(cur, concept);
    const prev = q.start ? ytd(q.start) : undefined;
    if (!prev) return null;
    return {
      value: cur.val - prev.val,
      concept,
      accn: cur.accn,
      form: cur.form,
      derived: q.label.startsWith("Q4") ? "fy_minus_9m" : "ytd_difference",
    };
  });
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

// ---- Shares outstanding and splits -------------------------------------------

/** Split ratios that occur in practice; any other big jump is treated as unreliable data. */
const SPLIT_RATIOS = [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50, 100];
const SPLIT_JUMP = 1.5; // quarter-to-quarter share counts never move this much without a split or a deal

function splitRatio(r: number): number | null {
  const inv = r < 1;
  const x = inv ? 1 / r : r;
  const n = SPLIT_RATIOS.find((k) => Math.abs(x / k - 1) <= 0.06);
  return n ? (inv ? 1 / n : n) : null;
}

export function parseShares(dei: ConceptMap | undefined): SharesHistory {
  const facts = factsOf(dei ?? {}, "EntityCommonStockSharesOutstanding", "shares").filter((f) => f.val > 0);
  const byEnd = new Map<string, Fact>(); // latest-filed count for each date
  for (const f of facts) {
    const prev = byEnd.get(f.end);
    if (!prev || f.filed > prev.filed) byEnd.set(f.end, f);
  }
  const points = [...byEnd.values()]
    .sort((a, b) => (a.end < b.end ? -1 : 1))
    .map((f) => ({ end: f.end, value: f.val, filed: f.filed }));

  const splits: Split[] = [];
  let reliableFrom: string | null = null;
  for (let i = 1; i < points.length; i++) {
    const r = points[i].value / points[i - 1].value;
    if (r < SPLIT_JUMP && r > 1 / SPLIT_JUMP) continue;
    const ratio = splitRatio(r);
    if (ratio) splits.push({ after: points[i - 1].end, before: points[i].end, ratio });
    else reliableFrom = points[i].end; // keep only what follows the last unexplained jump
  }
  return { points, splits: reliableFrom ? splits.filter((s) => s.after >= reliableFrom!) : splits, reliableFrom };
}

export function parseCompanyFacts(json: unknown, opts: { years?: number; quarters?: number } = {}): Financials {
  if (!json || typeof json !== "object") throw new Error("sec: unexpected companyfacts payload");
  const root = json as { cik?: unknown; entityName?: unknown; facts?: { "us-gaap"?: ConceptMap; dei?: ConceptMap } };
  const gaap = root.facts?.["us-gaap"];
  if (!gaap) throw new Error("sec: no us-gaap facts");

  const years = annualPeriods(gaap, opts.years ?? 15);
  const closed = annualPeriods(gaap, 100); // quarter derivation needs the fiscal-year bounds
  const open = openYear(closed);
  const allYears = open ? [...closed, open] : closed;
  // 24 quarters: the table shows them all, and valuation needs trailing-12-month figures
  // going back 5 years (each one sums the 4 quarters before it).
  const quarters = quarterPeriods(gaap, allYears, opts.quarters ?? 24);

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
    shares: parseShares(root.facts?.dei),
  };
}

/** Link to the filing index on EDGAR for a cell's accession number. */
export function filingUrl(cik: number, accn: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}/${accn}-index.htm`;
}

export function companyFactsUrl(cik: number): string {
  return `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`;
}
