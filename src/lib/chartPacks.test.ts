import { describe, expect, it } from "vitest";
import { parseConfig, writeConfig } from "./chartConfig";
import {
  BUILTIN_PACKS, MAX_CHARTS, MAX_PACKS, addChart, canHavePeers, chartFromConfig, configFor, createPack, deletePack, moveChart, parsePacks, removeChart, renamePack,
  type PackChart,
} from "./chartPacks";
import { median, peerMedian, readout } from "./chartStats";

const roic: PackChart = { metrics: ["roic"], freq: "annual", transform: "values", kind: "line", range: 10, peers: true };

describe("chart packs", () => {
  it("built-in packs are valid charts", () => {
    for (const p of BUILTIN_PACKS) for (const ch of p.charts) expect(chartFromConfig(configFor(ch, "AAPL"))).toEqual(ch);
  });

  it("opens a pack chart for any company, keeping the peer median only where it applies", () => {
    expect(configFor(roic, "MSFT")).toMatchObject({ symbols: ["MSFT"], metrics: ["roic"], peers: true });
    const two: PackChart = { ...roic, metrics: ["roic", "roe"], peers: true };
    expect(configFor(two, "MSFT").peers).toBe(false); // two metrics: no single peer line
    expect(canHavePeers({ symbols: ["A"], metrics: ["pe"], freq: "monthly", transform: "values" })).toBe(false); // market data would cost quota
    expect(canHavePeers({ symbols: ["A"], metrics: ["roic"], freq: "annual", transform: "index" })).toBe(false); // each company has its own base
  });

  it("keeps the peer median in the chart URL", () => {
    const qs = writeConfig({ symbols: ["AAPL"], metrics: ["roic"], freq: "annual", transform: "values", kind: "line", range: 10, peers: true });
    expect(qs).toContain("p=1");
    expect(parseConfig(new URLSearchParams(qs)).peers).toBe(true);
    expect(parseConfig(new URLSearchParams("s=AAPL,MSFT&m=roic&p=1")).peers).toBeUndefined();
  });

  it("reads stored packs defensively", () => {
    const packs = parsePacks([
      { id: "mine", name: "  My   pack ", charts: [roic, roic, { metrics: ["bogus"] }, { metrics: ["revenue"], freq: "nope" }] },
      { id: "essentials", name: "clash with a built-in", charts: [] },
      { id: "BAD ID", name: "x", charts: [] },
      { id: "mine", name: "duplicate id", charts: [] },
      "junk",
    ]);
    expect(packs).toHaveLength(1);
    expect(packs[0].name).toBe("My pack");
    expect(packs[0].charts).toHaveLength(2); // duplicate dropped; "bogus" metric falls back to a default chart, kept once
    expect(parsePacks({})).toEqual([]);
  });

  it("creates, fills, reorders, renames and deletes packs within the limits", () => {
    let r = createPack([], "Quality", "p1", roic);
    expect(r.ok).toBe(true);
    let packs = r.ok ? r.packs : [];
    expect(addChart(packs, "p1", roic)).toEqual({ ok: false, reason: "duplicate" });
    const rev: PackChart = { ...roic, metrics: ["revenue"], peers: false, kind: "bar" };
    r = addChart(packs, "p1", rev);
    packs = r.ok ? r.packs : packs;
    expect(moveChart(packs, "p1", 1, -1)[0].charts.map((c) => c.metrics[0])).toEqual(["revenue", "roic"]);
    expect(moveChart(packs, "p1", 0, -1)).toEqual(packs); // already first
    expect(removeChart(packs, "p1", 0)[0].charts).toEqual([rev]);
    expect(renamePack(packs, "p1", "   ")[0].name).toBe("Quality");
    expect(renamePack(packs, "p1", "Moat")[0].name).toBe("Moat");
    expect(deletePack(packs, "p1")).toEqual([]);
    expect(createPack(packs, "  ", "p2")).toEqual({ ok: false, reason: "name" });
    const many = Array.from({ length: MAX_PACKS }, (_, i) => ({ id: `p${i}`, name: `P${i}`, charts: [] }));
    expect(createPack(many, "One more", "px")).toEqual({ ok: false, reason: "limit" });
    const full = [{ id: "f", name: "F", charts: Array.from({ length: MAX_CHARTS }, (_, i) => ({ ...rev, range: [5, 10, 0][i % 3], transform: (["values", "growth", "index"] as const)[Math.floor(i / 3)] })) }];
    expect(addChart(full, "f", roic)).toEqual({ ok: false, reason: "full" });
  });
});

describe("chart readouts", () => {
  it("medians need enough peers", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    const m = peerMedian([[0.1, 0.2, null], [0.3, null, null], [0.2, 0.4, 0.5], [0.5, 0.1, null]]);
    expect(m.values).toEqual([0.25, 0.2, null]); // last period has one peer only
    expect(m.counts).toEqual([4, 3, 1]);
  });

  it("gives a yearly growth rate between two positive amounts", () => {
    const r = readout([100, 110, null, 133.1], "usd", "annual", "values");
    expect(r?.kind).toBe("cagr");
    expect(r && r.kind === "cagr" && r.rate).toBeCloseTo(0.1);
    expect(r && r.kind === "cagr" && r.years).toBe(3);
    expect(readout([-5, 10, 20], "usd", "annual", "values")).toEqual({ kind: "cagr", rate: 1, years: 1, from: 10, to: 20 }); // starts after the loss
    expect(readout([10, 20, -5], "usd", "annual", "values")).toBeNull(); // into a loss: no rate
  });

  it("compares quarters with the same quarter", () => {
    // Six quarters: last index 5, so the first point used is index 1 (a year before).
    const r = readout([1, 100, 50, 60, 70, 121], "usd", "quarterly", "values");
    expect(r).toMatchObject({ kind: "cagr", from: 100, to: 121, years: 1 });
  });

  it("uses points for percentages, from→to for multiples and the median for growth charts", () => {
    expect(readout([0.2, 0.25], "pct", "annual", "values")).toMatchObject({ kind: "points", change: expect.closeTo(0.05) });
    expect(readout([25, 30], "multiple", "annual", "values")).toEqual({ kind: "change", from: 25, to: 30 });
    expect(readout([0.1, 0.3, 0.2], "pct", "annual", "growth")).toEqual({ kind: "median", value: 0.2, n: 3 });
    expect(readout([null, 5], "usd", "annual", "values")).toBeNull();
  });
});
