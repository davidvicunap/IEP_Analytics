import { describe, expect, it } from "vitest";
import { compsRow, impliedValues, netDebtOf, peerStats, quantile, type CompsCompany } from "./comps";

// Target: revenue 1,000, operating income 200, D&A 50 (EBITDA 250), net income 150,
// equity 600, OCF 260, capex 60 (FCF 200), debt 300 + 100, cash 150 → net debt 250.
const target: CompsCompany = {
  symbol: "ME", name: "Me", marketCap: 3000, marketCapSource: "market",
  inputs: { revenue: 1000, revenuePrev: 800, operatingIncome: 200, depreciation: 50, netIncome: 150, equity: 600, ocf: 260, capex: 60, longTermDebt: 300, currentDebt: 100, cash: 150 },
};
const peer = (symbol: string, marketCap: number | null, k: number): CompsCompany => ({
  symbol, name: symbol, marketCap, marketCapSource: marketCap === null ? null : "market",
  inputs: { revenue: 100 * k, operatingIncome: 20 * k, depreciation: 5 * k, netIncome: 10 * k, equity: 50 * k, ocf: 15 * k, capex: 5 * k, longTermDebt: 10 * k, cash: 10 * k },
});

describe("comps rows", () => {
  const r = compsRow(target);
  it("EV = market cap + debt − cash, EBITDA = operating income + D&A", () => {
    expect(netDebtOf(target.inputs!)).toBe(250);
    expect(r.ev).toBe(3250);
    expect(r.ebitda).toBe(250);
    expect(r.fcf).toBe(200);
  });
  it("multiples and margins", () => {
    expect(r.multiples.evSales).toBeCloseTo(3.25);
    expect(r.multiples.evEbitda).toBeCloseTo(13);
    expect(r.multiples.pe).toBeCloseTo(20);
    expect(r.multiples.pb).toBeCloseTo(5);
    expect(r.multiples.fcfYield).toBeCloseTo(200 / 3000);
    expect(r.growth).toBeCloseTo(0.25);
    expect(r.operatingMargin).toBeCloseTo(0.2);
  });
  it("leaves EV out without cash, and every multiple out without a market cap", () => {
    expect(compsRow({ ...target, inputs: { ...target.inputs!, cash: undefined } }).ev).toBeNull();
    const none = compsRow({ ...target, marketCap: null });
    expect(Object.values(none.multiples).every((v) => v === null)).toBe(true);
  });
  it("skips revenue multiples when SEC revenue is ambiguous, and P/E on losses", () => {
    const amb = compsRow({ ...target, inputs: { ...target.inputs!, revenueAmbiguous: 1, netIncome: -5 } });
    expect(amb.multiples.evSales).toBeNull();
    expect(amb.multiples.pe).toBeNull();
    expect(amb.multiples.evEbitda).toBeCloseTo(13);
  });
});

describe("peer statistics", () => {
  it("quantiles interpolate like PERCENTILE.INC", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75);
    expect(quantile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25);
    expect(quantile([], 0.5)).toBeNull();
  });
  it("median, mean and quartiles over peers with a value", () => {
    // P/E of peers: market cap / (10k): 10, 15, 20, (no price)
    const rows = [peer("A", 100, 1), peer("B", 300, 2), peer("C", 600, 3), peer("D", null, 4)].map(compsRow);
    expect(peerStats(rows, "pe")).toEqual({ n: 3, low: 12.5, median: 15, mean: 15, high: 17.5 });
  });
});

describe("implied values", () => {
  const peers = [peer("A", 100, 1), peer("B", 300, 2), peer("C", 600, 3)].map(compsRow);
  const values = impliedValues(compsRow(target), peers, 30); // 3,000 / 30 = 100 shares

  it("applies the median P/E to the target's net income", () => {
    const pe = values.find((v) => v.multiple === "pe")!;
    expect(pe.mid).toBeCloseTo((15 * 150) / 100); // 22.5 per share
    expect(pe.low).toBeCloseTo((12.5 * 150) / 100);
    expect(pe.high).toBeCloseTo((17.5 * 150) / 100);
  });

  it("bridges EV multiples through net debt", () => {
    // peer EV/EBITDA: (100+0)/25 = 4, (300)/50 = 6, (600)/75 = 8 → median 6
    const ev = values.find((v) => v.multiple === "evEbitda")!;
    expect(ev.mid).toBeCloseTo((6 * 250 - 250) / 100); // 12.5 per share
  });

  it("inverts yields: the low end comes from the high peer yield", () => {
    const y = values.find((v) => v.multiple === "fcfYield")!;
    // peer FCF yields: 10/100 = 0.1, 20/300, 30/600 = 0.05
    expect(y.low).toBeLessThan(y.mid);
    expect(y.mid).toBeCloseTo(200 / (20 / 300) / 100);
  });

  it("can use the mean instead of the median", () => {
    const mean = impliedValues(compsRow(target), peers, 30, "mean").find((v) => v.multiple === "pe")!;
    expect(mean.mid).toBeCloseTo((15 * 150) / 100);
  });
});
