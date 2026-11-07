import { describe, expect, it } from "vitest";
import { filingUrl, parseCompanyFacts } from "./secFinancials";

// A compact companyfacts payload with the traps real filings have.
const K24 = { accn: "0000320193-24-000123", form: "10-K", filed: "2024-11-01" };
const K25 = { accn: "0000320193-25-000079", form: "10-K", filed: "2025-10-31" };
const Q1 = { accn: "0000320193-25-000008", form: "10-Q", filed: "2025-01-31" };
const Q2 = { accn: "0000320193-25-000057", form: "10-Q", filed: "2025-05-02" };
const Q3 = { accn: "0000320193-25-000073", form: "10-Q", filed: "2025-08-01" };

const FY23 = { start: "2022-09-25", end: "2023-09-30" };
const FY24 = { start: "2023-10-01", end: "2024-09-28" };
const FY25 = { start: "2024-09-29", end: "2025-09-27" };
const q = (start: string, end: string) => ({ start, end });
const Q1P = q("2024-09-29", "2024-12-28");
const Q2P = q("2024-12-29", "2025-03-29");
const Q3P = q("2024-03-30", "2025-06-28"); // placeholder start, replaced below
Q3P.start = "2025-03-30";
const H1 = q("2024-09-29", "2025-03-29");
const M9 = q("2024-09-29", "2025-06-28");

const usd = (facts: object[]) => ({ units: { USD: facts } });

const FACTS = {
  cik: 320193,
  entityName: "Apple Inc.",
  facts: {
    "us-gaap": {
      // Old revenue tag, used until FY2024.
      Revenues: usd([
        { ...FY23, val: 383e9, ...K24 },
        { ...FY24, val: 391e9, ...K24 },
      ]),
      // New tag from FY2025, also re-reporting FY2024 as a comparative.
      RevenueFromContractWithCustomerExcludingAssessedTax: usd([
        { ...FY24, val: 391e9, ...K25 },
        { ...FY25, val: 416e9, ...K25 },
        { ...Q1P, val: 124e9, ...Q1 },
        { ...Q2P, val: 95e9, ...Q2 },
        { ...H1, val: 219e9, ...Q2 },
        { ...Q3P, val: 94e9, ...Q3 },
        { ...M9, val: 313e9, ...Q3 },
      ]),
      NetIncomeLoss: usd([
        { ...FY23, val: 97e9, ...K24 },
        { ...FY24, val: 93.7e9, ...K24 },
        { ...FY24, val: 94.0e9, ...K25 }, // restated in the next 10-K
        { ...FY25, val: 112e9, ...K25 },
        { ...Q1P, val: 36e9, ...Q1 },
        { ...Q2P, val: 25e9, ...Q2 },
        { ...Q3P, val: 23e9, ...Q3 },
      ]),
      // Cash flow is only reported year-to-date in 10-Qs.
      NetCashProvidedByUsedInOperatingActivities: usd([
        { ...FY25, val: 111e9, ...K25 },
        { ...Q1P, val: 30e9, ...Q1 },
        { ...H1, val: 54e9, ...Q2 },
        { ...M9, val: 81e9, ...Q3 },
      ]),
      PaymentsToAcquirePropertyPlantAndEquipment: usd([
        { ...FY25, val: 12e9, ...K25 },
        { ...Q1P, val: 3e9, ...Q1 },
        { ...H1, val: 6e9, ...Q2 },
        { ...M9, val: 9e9, ...Q3 },
      ]),
      EarningsPerShareDiluted: {
        units: {
          "USD/shares": [
            { ...FY25, val: 7.49, ...K25 },
            { ...Q1P, val: 2.4, ...Q1 },
            { ...Q2P, val: 1.65, ...Q2 },
            { ...Q3P, val: 1.57, ...Q3 },
          ],
        },
      },
      Assets: usd([
        { end: "2024-09-28", val: 365e9, ...K24 },
        { end: "2025-09-27", val: 360e9, ...K25 },
        { end: "2024-12-28", val: 344e9, ...Q1 },
      ]),
    },
  },
};

const fin = parseCompanyFacts(FACTS);

describe("annual statements", () => {
  it("finds one period per fiscal year, oldest first", () => {
    expect(fin.annual.periods.map((p) => p.label)).toEqual(["FY2023", "FY2024", "FY2025"]);
    expect(fin.annual.periods[1]).toMatchObject({ end: "2024-09-28", accn: K24.accn });
  });

  it("follows a revenue tag change across years", () => {
    const rev = fin.annual.lines.revenue!;
    expect(rev.map((c) => c.value)).toEqual([383e9, 391e9, 416e9]);
    expect(rev[0].concept).toBe("Revenues");
    expect(rev[2].concept).toBe("RevenueFromContractWithCustomerExcludingAssessedTax");
  });

  it("uses the most recently filed value for restated periods and cites that filing", () => {
    const ni = fin.annual.lines.netIncome![1];
    expect(ni).toMatchObject({ value: 94.0e9, accn: K25.accn });
  });

  it("derives free cash flow and drops lines with no data", () => {
    expect(fin.annual.lines.freeCashFlow![2]).toMatchObject({ value: 99e9, derived: "formula" });
    expect(fin.annual.lines.grossProfit).toBeUndefined();
    expect(fin.annual.lines.totalAssets!.map((c) => c.value)).toEqual([null, 365e9, 360e9]);
  });
});

describe("quarterly statements", () => {
  it("labels quarters inside the fiscal year, Q4 at the fiscal year end", () => {
    expect(fin.quarterly.periods.map((p) => p.label)).toEqual(["Q1 FY2025", "Q2 FY2025", "Q3 FY2025", "Q4 FY2025"]);
    expect(fin.quarterly.periods[3].end).toBe(FY25.end);
  });

  it("uses reported 3-month values and derives Q4 as fiscal year minus 9-month YTD", () => {
    const rev = fin.quarterly.lines.revenue!;
    expect(rev.map((c) => c.value)).toEqual([124e9, 95e9, 94e9, 103e9]);
    expect(rev[3]).toMatchObject({ derived: "fy_minus_9m", accn: K25.accn });
    expect(rev[1].derived).toBeUndefined();
  });

  it("derives quarterly cash flow from year-to-date figures", () => {
    const ocf = fin.quarterly.lines.operatingCashFlow!;
    expect(ocf.map((c) => c.value)).toEqual([30e9, 24e9, 27e9, 30e9]);
    expect(ocf[1].derived).toBe("ytd_difference");
    expect(fin.quarterly.lines.freeCashFlow!.map((c) => c.value)).toEqual([27e9, 21e9, 24e9, 27e9]);
  });

  it("never derives per-share values by subtraction", () => {
    expect(fin.quarterly.lines.epsDiluted!.map((c) => c.value)).toEqual([2.4, 1.65, 1.57, null]);
  });

  it("takes balance-sheet values at the quarter end", () => {
    expect(fin.quarterly.lines.totalAssets!.map((c) => c.value)).toEqual([344e9, null, null, 360e9]);
  });
});

describe("safety", () => {
  it("rejects payloads without us-gaap facts", () => {
    expect(() => parseCompanyFacts({ facts: {} })).toThrow();
    expect(() => parseCompanyFacts(null)).toThrow();
  });

  it("builds EDGAR filing links from the accession number", () => {
    expect(filingUrl(320193, "0000320193-25-000079")).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/0000320193-25-000079-index.htm",
    );
  });
});

describe("fiscal year in progress (bank, calendar year)", () => {
  const K = { accn: "0000019617-26-000001", form: "10-K", filed: "2026-02-13" };
  const QA = { accn: "0000019617-26-000002", form: "10-Q", filed: "2026-05-01" };
  const QB = { accn: "0000019617-26-000003", form: "10-Q", filed: "2026-08-01" };
  const bank = parseCompanyFacts({
    cik: 19617,
    entityName: "Bank",
    facts: {
      "us-gaap": {
        // The 10-K tags total net revenue as Revenues; the 10-Qs use the bank-specific tag.
        Revenues: usd([{ start: "2025-01-01", end: "2025-12-31", val: 182e9, ...K }]),
        RevenuesNetOfInterestExpense: usd([
          { start: "2026-01-01", end: "2026-03-31", val: 50e9, ...QA },
          { start: "2026-04-01", end: "2026-06-30", val: 51e9, ...QB },
        ]),
        NetIncomeLoss: usd([
          { start: "2025-01-01", end: "2025-12-31", val: 57e9, ...K },
          { start: "2026-01-01", end: "2026-03-31", val: 16e9, ...QA },
          { start: "2026-04-01", end: "2026-06-30", val: 15e9, ...QB },
        ]),
        NetCashProvidedByUsedInOperatingActivities: usd([
          { start: "2026-01-01", end: "2026-03-31", val: -20e9, ...QA },
          { start: "2026-01-01", end: "2026-06-30", val: 10e9, ...QB },
        ]),
      },
    },
  });

  it("shows the quarters filed after the last 10-K, with no Q4 yet", () => {
    expect(bank.quarterly.periods.map((p) => p.label)).toEqual(["Q1 FY2026", "Q2 FY2026"]);
    expect(bank.quarterly.periods[1]).toMatchObject({ accn: QB.accn, start: "2026-03-31" });
  });

  it("reads bank revenue tagged net of interest expense", () => {
    expect(bank.quarterly.lines.revenue!.map((c) => c.value)).toEqual([50e9, 51e9]);
    expect(bank.quarterly.lines.revenue![0].concept).toBe("RevenuesNetOfInterestExpense");
    expect(bank.annual.lines.revenue![0].value).toBe(182e9);
  });

  it("derives in-progress quarters from year-to-date cash flow", () => {
    expect(bank.quarterly.lines.operatingCashFlow!.map((c) => c.value)).toEqual([-20e9, 30e9]);
  });
});
