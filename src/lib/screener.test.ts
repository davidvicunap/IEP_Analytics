import { describe, expect, it } from "vitest";
import { EMPTY_SCREEN, PRESETS, divisionOf, parseScreen, passes, runScreen, screenRow, writeScreen, type Screen, type ScreenRow } from "./screener";

const company = (symbol: string, rank: number, sic: number | null, industry: string) => ({ symbol, name: `${symbol} Inc.`, cik: rank, rank, sic, industry });

// Figures in millions; ratios follow lib/ratios.ts.
const rows: ScreenRow[] = [
  screenRow(company("SOFT", 1, 7372, "SERVICES-PREPACKAGED SOFTWARE"), { revenue: 200, revenuePrev: 160, grossProfit: 160, operatingIncome: 80, netIncome: 60, ocf: 90, capex: 10, equity: 300, longTermDebt: 30, assets: 500, eps: 3, epsPrev: 2 }),
  screenRow(company("SHOE", 2, 3021, "RUBBER & PLASTICS FOOTWEAR"), { revenue: 500, revenuePrev: 480, grossProfit: 220, operatingIncome: 60, netIncome: 40, ocf: 50, capex: 20, equity: 200, longTermDebt: 150, assets: 600 }),
  screenRow(company("BANK", 3, 6021, "NATIONAL COMMERCIAL BANKS"), { revenue: 100, netIncome: 30, equity: 250, assets: 3000, longTermDebt: 900, eps: 4, epsPrev: 3.5 }),
  screenRow(company("BUYB", 4, 2080, "BEVERAGES"), { revenue: 300, revenuePrev: 290, grossProfit: 180, operatingIncome: 90, netIncome: 70, equity: -50, longTermDebt: 400, assets: 900 }),
  screenRow(company("AMBG", 5, null, ""), { revenue: 1000, revenuePrev: 100, grossProfit: 900, revenueAmbiguous: 1, equity: 100, netIncome: 10 }),
];
const bySymbol = (s: string) => rows.find((r) => r.symbol === s)!;
const screen = (patch: Partial<Screen>): Screen => ({ ...EMPTY_SCREEN, ...patch });

describe("rows", () => {
  it("compute the same ratios as the stock pages", () => {
    const soft = bySymbol("SOFT").ratios;
    expect(soft.grossMargin).toBeCloseTo(0.8);
    expect(soft.revenueGrowth).toBeCloseTo(0.25);
    expect(soft.fcfMargin).toBeCloseTo(0.4);
    expect(soft.roic).toBeCloseTo((80 * 0.79) / 330);
    expect(soft.debtToEquity).toBeCloseTo(0.1);
  });

  it("leave out ratios that don't apply, rest on negative equity or on an ambiguous revenue", () => {
    expect(bySymbol("BANK").ratios.grossMargin).toBeNull(); // banks: no comparable revenue
    expect(bySymbol("BANK").ratios.roe).toBeCloseTo(0.12);
    expect(bySymbol("BUYB").ratios.roe).toBeNull(); // negative equity
    expect(bySymbol("BUYB").ratios.debtToEquity).toBeNull();
    expect(bySymbol("AMBG").ratios.revenueGrowth).toBeNull();
    expect(bySymbol("AMBG").revenue).toBeNull();
  });

  it("place companies in SIC divisions", () => {
    expect(divisionOf(7372)).toBe("services");
    expect(divisionOf(3021)).toBe("manufacturing");
    expect(divisionOf(6021)).toBe("finance");
    expect(divisionOf(null)).toBeNull();
  });
});

describe("filters", () => {
  it("treat lower-is-better ratios as maximums and missing values as not passing", () => {
    const s = screen({ bounds: { debtToEquity: 0.5 } });
    expect(passes(bySymbol("SOFT"), s)).toBe(true);
    expect(passes(bySymbol("SHOE"), s)).toBe(false); // 0.75
    expect(passes(bySymbol("BUYB"), s)).toBe(false); // negative equity: no figure
  });

  it("combine thresholds, sector, industry text and size", () => {
    expect(runScreen(rows, screen({ bounds: { grossMargin: 0.4 } })).rows.map((r) => r.symbol)).toEqual(["SOFT", "SHOE", "BUYB"]);
    expect(runScreen(rows, screen({ division: "manufacturing" })).rows.map((r) => r.symbol)).toEqual(["SHOE", "BUYB"]);
    expect(runScreen(rows, screen({ industry: "software" })).rows.map((r) => r.symbol)).toEqual(["SOFT"]);
    expect(runScreen(rows, screen({ size: "100" })).matched).toBe(5);
  });

  it("run the presets", () => {
    expect(runScreen(rows, screen(PRESETS.quality)).rows.map((r) => r.symbol)).toEqual(["SOFT"]);
    expect(runScreen(rows, screen(PRESETS.growth)).rows.map((r) => r.symbol)).toEqual(["SOFT"]);
  });

  it("sort with empty values last, and cap the rows returned", () => {
    const s = runScreen(rows, screen({ sort: "roe", dir: "desc" }), 3);
    expect(s.matched).toBe(5);
    expect(s.rows.map((r) => r.symbol)).toEqual(["SHOE", "SOFT", "BANK"]); // SHOE and SOFT tie at 20 %: alphabetical
    const asc = runScreen(rows, screen({ sort: "roe", dir: "asc" }));
    expect(asc.rows.map((r) => r.symbol)).toEqual(["AMBG", "BANK", "SHOE", "SOFT", "BUYB"]); // BUYB has no ROE: last
  });
});

describe("URL state", () => {
  it("round-trips a screen with percentages in the URL", () => {
    const s = screen({ bounds: { roic: 0.15, grossMargin: 0.4, debtToEquity: 0.5 }, division: "services", industry: "software", size: "500", sort: "roic", dir: "desc" });
    const q = writeScreen(s);
    expect(q).toBe("gm=40&roic=15&de=0.5&sector=services&q=software&size=500&sort=roic");
    expect(parseScreen(new URLSearchParams(q))).toEqual(s);
  });

  it("ignores junk and keeps defaults short", () => {
    expect(parseScreen(new URLSearchParams("gm=abc&sector=moon&size=7&sort=evil&q=" + "x".repeat(200)))).toEqual({ ...EMPTY_SCREEN, industry: "x".repeat(60) });
    expect(writeScreen(EMPTY_SCREEN)).toBe("");
  });
});
