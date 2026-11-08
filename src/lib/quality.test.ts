import { describe, expect, it } from "vitest";
import type { StatementSet } from "./secFinancials";
import { CHECKS, assessQuality, cagr, growthTable, runCheck, splitFactors, summarizeChecks, yearRows } from "./quality";

const cells = (xs: (number | null)[]) => xs.map((value) => ({ value }));
const years = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ end: `${from + i}-09-30`, label: `FY${from + i}` }));

describe("stock splits in per-share figures", () => {
  // AAPL as filed: FY2015–FY2017 come from pre-2020 filings (old basis), FY2018 on are restated
  // for the 4-for-1 split of August 2020. The 7-for-1 split of 2014 was already restated.
  const set: StatementSet = {
    periods: years(2014, 7),
    lines: {
      epsDiluted: cells([6.45, 9.22, 8.31, 9.21, 2.98, 2.97, 3.28]),
      dilutedShares: cells([6_122_663_000, 5_793_069_000, 5_500_281_000, 5_251_692_000, 20_000_435_000, 18_595_651_000, 17_528_214_000]),
    },
  };
  const splits = [
    { after: "2014-04-11", before: "2014-07-11", ratio: 7 },
    { after: "2020-07-17", before: "2020-10-16", ratio: 4 },
  ];

  it("restates the years before the jump to today's share basis", () => {
    expect(splitFactors(set, splits)).toEqual([4, 4, 4, 4, 1, 1, 1]);
    const rows = yearRows(set, splits);
    expect(rows[3].eps).toBeCloseTo(2.3025);
    expect(rows[3].shares).toBe(21_006_768_000);
  });

  it("leaves figures alone when the split was already restated or the jump isn't the split", () => {
    expect(splitFactors(set, [splits[0]])).toEqual([1, 1, 1, 1, 1, 1, 1]);
    const merger = { ...set, lines: { ...set.lines, dilutedShares: cells([100, 100, 100, 100, 250, 250, 250]) } };
    expect(splitFactors(merger, [splits[1]])).toEqual([1, 1, 1, 1, 1, 1, 1]); // ×2.5 isn't a 4-for-1
    const later = { ...set, periods: years(2010, 7) }; // the jump comes after the split's fiscal year: not this split
    expect(splitFactors(later, [{ after: "2011-01-01", before: "2011-03-01", ratio: 4 }])).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
});

// Ten years of a business that compounds: revenue +10 %/yr, 60 % gross margin, 30 % operating
// margin, net income 20 % of revenue, FCF above net income, little capex and debt, and fewer
// shares every year.
const n = 10;
const rev = Array.from({ length: n }, (_, i) => 1000 * 1.1 ** i);
const great: StatementSet = {
  periods: years(2016, n),
  lines: {
    revenue: cells(rev),
    grossProfit: cells(rev.map((r) => r * 0.6)),
    operatingIncome: cells(rev.map((r) => r * 0.3)),
    netIncome: cells(rev.map((r) => r * 0.2)),
    epsDiluted: cells(rev.map((r, i) => (r * 0.2) / (100 - 2 * i))),
    dilutedShares: cells(rev.map((_, i) => 100 - 2 * i)),
    freeCashFlow: cells(rev.map((r) => r * 0.22)),
    capex: cells(rev.map((r) => r * 0.04)),
    equity: cells(rev.map((r) => r * 0.8)),
    totalAssets: cells(rev.map((r) => r * 2)),
    longTermDebt: cells(rev.map((r) => r * 0.3)),
    interestExpense: cells(rev.map((r) => r * 0.01)),
  },
};

describe("quality checks", () => {
  it("passes a business that compounds on little capital", () => {
    const { checks, summary } = assessQuality(great, [], "general");
    expect(checks.map((c) => c.key)).toEqual(CHECKS.general);
    expect(checks.every((c) => c.status === "pass")).toBe(true);
    expect(summary).toEqual({ passed: 8, failed: 0, na: 0, level: "high" });
    const roic = checks.find((c) => c.key === "roic")!;
    expect(roic.facts.median).toBeCloseTo((0.3 * 0.79) / 1.1); // after-tax operating income ÷ (equity + debt)
    expect(roic).toMatchObject({ from: "FY2016", to: "FY2025", facts: { count: 10, n: 10 } });
    expect(checks.find((c) => c.key === "debt")!.facts.years).toBeCloseTo((0.3 * 1.1 ** 9) / ((0.2 * (1.1 ** 7 + 1.1 ** 8 + 1.1 ** 9)) / 3));
    expect(checks.find((c) => c.key === "buybacks")!.facts.change).toBeCloseTo(82 / 100 - 1);
  });

  it("fails the checks a capital-hungry, shrinking business misses", () => {
    const poor: StatementSet = {
      ...great,
      lines: {
        ...great.lines,
        grossProfit: cells(rev.map((r, i) => r * (0.45 - 0.015 * i))), // median ≥ 40 % but sliding
        netIncome: cells(rev.map((r) => r * 0.05)),
        epsDiluted: cells([1, 0.8, 1.1, 0.7, 0.9, 0.6, 0.8, 0.5, 0.7, 0.4]),
        freeCashFlow: cells(rev.map((r) => r * 0.02)),
        capex: cells(rev.map((r) => r * 0.08)),
        longTermDebt: cells(rev.map((r) => r * 2)),
        interestExpense: cells(rev.map((r) => r * 0.06)),
        dilutedShares: cells(rev.map((_, i) => 100 + 3 * i)),
      },
    };
    const { checks, summary } = assessQuality(poor, [], "general");
    const status = Object.fromEntries(checks.map((c) => [c.key, c.status]));
    expect(status).toEqual({
      roic: "fail", // 30 % operating margin, but on a capital base swollen by debt: ≈ 8.5 %
      grossMargin: "fail",
      epsGrowth: "fail",
      cashConversion: "fail",
      capex: "fail",
      debt: "fail",
      interest: "fail",
      buybacks: "fail",
    });
    expect(summary.level).toBe("low");
  });

  it("says when the data isn't there instead of guessing", () => {
    const short = { periods: great.periods.slice(-3), lines: Object.fromEntries(Object.entries(great.lines).map(([k, v]) => [k, v!.slice(-3)])) };
    const { checks, summary } = assessQuality(short, [], "general");
    expect(checks.filter((c) => c.status === "na").map((c) => c.key)).toEqual(["roic", "grossMargin", "epsGrowth", "cashConversion", "capex", "buybacks"]);
    expect(summary.level).toBe("na"); // only debt and interest could be judged
    const noInterest = { ...great, lines: { ...great.lines, interestExpense: cells(rev.map((r, i) => (i < 5 ? r * 0.01 : null))) } };
    expect(runCheck("interest", yearRows(noInterest, [])).status).toBe("na"); // nothing in the last 4 years
  });

  it("treats debt and losses honestly", () => {
    const rows = yearRows(great, []);
    const last = rows.length - 1;
    expect(runCheck("debt", rows.map((r, i) => (i === last ? { ...r, longTermDebt: 0 } : r)))).toMatchObject({ status: "pass", facts: { years: 0 } });
    const losing = rows.map((r) => ({ ...r, netIncome: -10 }));
    expect(runCheck("debt", losing)).toMatchObject({ status: "fail", facts: { noProfit: 1 } });
    expect(runCheck("cashConversion", losing)).toMatchObject({ status: "fail", facts: { noProfit: 1 } });
  });

  it("uses return on equity and book value for banks", () => {
    const { checks } = assessQuality(great, [], "bank");
    expect(checks.map((c) => c.key)).toEqual(["roe", "roa", "epsGrowth", "bookValue", "buybacks"]);
    expect(checks.find((c) => c.key === "roe")!.facts.median).toBeCloseTo(0.25);
    expect(checks.find((c) => c.key === "roa")!.facts.median).toBeCloseTo(0.1);
    expect(assessQuality(great, [], "reit").checks).toEqual([]);
  });

  it("grades the summary on the checks it could judge", () => {
    const c = (status: "pass" | "fail" | "na") => ({ key: "roic" as const, status, facts: {} });
    expect(summarizeChecks([c("pass"), c("pass"), c("pass"), c("fail"), c("na")]).level).toBe("high");
    expect(summarizeChecks([c("pass"), c("pass"), c("fail"), c("fail")]).level).toBe("mixed");
    expect(summarizeChecks([c("pass"), c("fail"), c("fail"), c("fail")]).level).toBe("low");
  });
});

describe("growth", () => {
  it("compounds over 3, 5 and 10 years when both ends are positive", () => {
    expect(cagr(100, 121, 2)).toBeCloseTo(0.1);
    expect(cagr(-5, 121, 2)).toBeNull();
    const g = growthTable(yearRows(great, []), "general");
    expect(g.map((r) => r.key)).toEqual(["revenue", "eps", "fcf"]);
    expect(g[0].cagr[3]).toBeCloseTo(0.1, 2);
    expect(g[0].cagr[5]).toBeCloseTo(0.1, 2);
    expect(g[0].cagr[10]).toBeNull(); // needs 11 fiscal years
    expect(growthTable(yearRows(great, []), "bank").map((r) => r.key)).toEqual(["eps", "bookValue"]);
  });
});
