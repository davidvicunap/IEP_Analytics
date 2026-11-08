import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/db/client", () => ({ getDb: () => null }));

import { getQuality, qualityPayload } from "./qualityData";
import type { StatementSet } from "./secFinancials";

const cells = (xs: number[]) => xs.map((value) => ({ value }));
const annual: StatementSet = {
  periods: Array.from({ length: 6 }, (_, i) => ({ end: `${2020 + i}-12-31`, label: `FY${2020 + i}`, accn: `0000-${i}`, form: "10-K" })),
  lines: {
    revenue: cells([100, 110, 120, 130, 140, 150]),
    netIncome: cells([10, 11, 12, 13, 14, 15]),
    epsDiluted: cells([4, 4.4, 1.2, 1.3, 1.4, 1.5]), // 4-for-1 split restated from FY2022 on
    dilutedShares: cells([2.5, 2.5, 10, 10, 10, 10]),
    equity: cells([50, 55, 60, 65, 70, 75]),
  },
};
const fin = { symbol: "TEST", cik: 1, entityName: "Test Inc.", annual, shares: { points: [], splits: [{ after: "2023-01-01", before: "2023-04-01", ratio: 4 }], reliableFrom: null } };

describe("quality payload", () => {
  it("carries the years, split-adjusted trends and the last fiscal year", () => {
    const p = qualityPayload(fin, "general");
    expect(p.years.map((y) => y.label)).toEqual(["FY2020", "FY2021", "FY2022", "FY2023", "FY2024", "FY2025"]);
    expect(p.splitAdjusted).toBe(true);
    expect(p.trends.find((t) => t.key === "eps")!.values).toEqual([1, 1.1, 1.2, 1.3, 1.4, 1.5]);
    expect(p.lastFiscal).toEqual({ label: "FY2025", end: "2025-12-31", revenue: 150, eps: 1.5 });
    expect(p.checks.find((c) => c.key === "epsGrowth")).toMatchObject({ status: "pass", facts: { ups: 5, pairs: 5 } });
  });

  it("shows banks their own trends", () => {
    expect(qualityPayload(fin, "bank").trends.map((t) => t.key)).toEqual(["netIncome", "eps", "bookValue", "roe", "roa", "shares"]);
  });

  it("says when there's no database to look the company up", async () => {
    expect(await getQuality("TEST")).toEqual({ ok: false, error: "not_configured" });
  });
});
