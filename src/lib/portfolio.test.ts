import { describe, expect, it } from "vitest";
import { byUrgency, holdingLight, holdingReasons, totals, type HoldingInput } from "./portfolio";

const base: HoldingInput = {
  position: { symbol: "AAPL", shares: 10, cost: 2000, avgPrice: 200, since: "2026-01-02", stop: null },
  price: 230,
  stop: 210,
  thesis: "onTrack",
  nextResults: null,
  lastReport: null,
  listing: { status: "active" },
  today: "2026-11-21",
};
const kinds = (h: Partial<HoldingInput>) => holdingReasons({ ...base, ...h }).map((r) => r.kind);

describe("one light per holding, with its reason", () => {
  it("green when there's an exit and nothing pending", () => {
    const r = holdingReasons(base);
    expect(r).toEqual([{ kind: "ok", stop: 210, gap: 230 / 210 - 1 }]);
    expect(holdingLight(r)).toBe("green");
  });

  it("amber with no exit set, results this week, a stop within 5 % or a fresh report", () => {
    expect(kinds({ stop: null })).toEqual(["noExit"]);
    expect(holdingReasons({ ...base, nextResults: "2026-11-24" })[0]).toEqual({ kind: "results", date: "2026-11-24", days: 3 });
    expect(kinds({ price: 215 })).toEqual(["nearStop"]);
    expect(kinds({ lastReport: { form: "10-Q", filed: "2026-11-18" } })).toEqual(["report"]);
    expect(kinds({ lastReport: { form: "10-Q", filed: "2026-10-01" } })).toEqual(["ok"]); // old news
    expect(holdingLight(holdingReasons({ ...base, stop: null }))).toBe("amber");
  });

  it("red when the price is at or under the stop, the thesis is at risk, or the stock no longer trades", () => {
    expect(kinds({ price: 205 })).toEqual(["belowStop"]);
    expect(kinds({ thesis: "atRisk" })).toEqual(["atRisk"]);
    expect(kinds({ listing: { status: "delisted" }, price: null })).toEqual(["delisted", "noPrice"]);
    expect(holdingLight(holdingReasons({ ...base, price: 205 }))).toBe("red");
  });

  it("the stop logged with the buy counts when the notebook has none; a renamed ticker says to what", () => {
    expect(kinds({ stop: null, position: { ...base.position, stop: 210 } })).toEqual(["ok"]);
    expect(holdingReasons({ ...base, listing: { status: "renamed", to: "META" } })[0]).toEqual({ kind: "renamed", to: "META" });
  });

  it("gray without a price, and never green without one", () => {
    expect(kinds({ price: null })).toEqual(["noPrice"]);
    expect(holdingLight(holdingReasons({ ...base, price: null }))).toBe("gray");
  });
});

describe("the whole portfolio", () => {
  it("adds up cost, value and gain; holdings without a price stay out of value and gain", () => {
    const t = totals([
      { position: base.position, price: 230 },
      { position: { ...base.position, symbol: "X", cost: 500 }, price: null },
    ]);
    expect(t).toEqual({ cost: 2500, value: 2300, gain: 300, unpriced: 1 });
  });

  it("orders red, amber, gray, green, then the biggest", () => {
    const rows = [
      { s: "G", light: "green" as const, value: 900 },
      { s: "A", light: "amber" as const, value: 10 },
      { s: "R", light: "red" as const, value: 5 },
      { s: "A2", light: "amber" as const, value: 50 },
    ];
    expect(rows.sort(byUrgency).map((r) => r.s)).toEqual(["R", "A2", "A", "G"]);
  });
});
