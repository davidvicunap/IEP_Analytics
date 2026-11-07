import { describe, expect, it } from "vitest";
import { cleanInputs, collectYear, framePeriod, frameUrl, parseFrame, pickReferenceYear } from "./secFrames";

const frame = (points: [number, number][]) => ({ data: points.map(([cik, val]) => ({ cik, val, accn: "x", end: "2025-12-31" })) });
const notFound = () => Object.assign(new Error("404"), { status: 404 });

describe("frames helpers", () => {
  it("builds frame URLs for flows, prior-year flows and year-end balances", () => {
    expect(framePeriod({ period: "year" }, 2025)).toBe("CY2025");
    expect(framePeriod({ period: "prevYear" }, 2025)).toBe("CY2024");
    expect(framePeriod({ period: "yearEnd" }, 2025)).toBe("CY2025Q4I");
    expect(frameUrl("Assets", "USD", "CY2025Q4I")).toBe("https://data.sec.gov/api/xbrl/frames/us-gaap/Assets/USD/CY2025Q4I.json");
  });

  it("keeps valid points and rejects unexpected payloads", () => {
    expect(parseFrame({ data: [{ cik: 1, val: 5 }, { cik: "x", val: 1 }, { cik: 2, val: null }] })).toEqual([{ cik: 1, val: 5 }]);
    expect(() => parseFrame({})).toThrow();
  });

  it("uses the latest year once it has ≥ 90 % of the previous year's filers", () => {
    expect(pickReferenceYear([{ year: 2025, pts: 5707 }, { year: 2024, pts: 6082 }])).toBe(2025);
    expect(pickReferenceYear([{ year: 2025, pts: 2100 }, { year: 2024, pts: 6082 }])).toBe(2024);
  });

  it("cleans jsonb read back from the database", () => {
    expect(cleanInputs({ revenue: 5, equity: "7", junk: 1 })).toEqual({ revenue: 5 });
    expect(cleanInputs(null)).toEqual({});
  });
});

describe("collectYear", () => {
  const responses: Record<string, unknown> = {
    "RevenueFromContractWithCustomerExcludingAssessedTax/USD/CY2025": frame([[1, 1000]]),
    "Revenues/USD/CY2025": frame([[1, 999], [2, 500], [3, 70]]), // company 1 already has a preferred tag
    "NetIncomeLoss/USD/CY2025": frame([[1, 100], [2, 40]]),
    "Assets/USD/CY2025Q4I": frame([[1, 3000]]),
  };
  const fetchJson = async (url: string) => {
    const key = url.replace("https://data.sec.gov/api/xbrl/frames/us-gaap/", "").replace(".json", "");
    if (key in responses) return responses[key];
    throw notFound();
  };

  it("takes the first concept in the chain per company and skips concepts with no frame", async () => {
    const m = await collectYear(2025, fetchJson);
    expect(m.get(1)).toEqual({ revenue: 1000, netIncome: 100, assets: 3000 });
    expect(m.get(2)).toEqual({ revenue: 500, netIncome: 40 });
  });

  it("keeps listed companies only", async () => {
    const m = await collectYear(2025, fetchJson, new Set([2]));
    expect([...m.keys()]).toEqual([2]);
  });

  it("aborts on any error other than 404, so partial data never replaces good data", async () => {
    const failing = async (url: string) => {
      if (url.includes("NetIncomeLoss")) throw Object.assign(new Error("429"), { status: 429 });
      return fetchJson(url);
    };
    await expect(collectYear(2025, failing)).rejects.toThrow("429");
  });
});

describe("collectYear revenue rule", () => {
  const responses: Record<string, unknown> = {
    "RevenueFromContractWithCustomerExcludingAssessedTax/USD/CY2025": frame([[1, 27], [2, 100], [3, 50]]),
    "Revenues/USD/CY2025": frame([[1, 85], [2, 101]]),
    "RevenueFromContractWithCustomerIncludingAssessedTax/USD/CY2025": frame([[2, 999], [4, 40]]),
  };
  const fetchJson = async (url: string) => {
    const key = url.replace("https://data.sec.gov/api/xbrl/frames/us-gaap/", "").replace(".json", "");
    if (key in responses) return responses[key];
    throw notFound();
  };

  it("takes the largest total, flags totals more than 2 % apart, and falls back last", async () => {
    const m = await collectYear(2025, fetchJson);
    expect(m.get(1)).toEqual({ revenue: 85, revenueAmbiguous: 1 });
    expect(m.get(2)).toEqual({ revenue: 101 }); // 1 % apart: fine; excise-tax total ignored
    expect(m.get(3)).toEqual({ revenue: 50 });
    expect(m.get(4)).toEqual({ revenue: 40 }); // fallback only
  });
});
