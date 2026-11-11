import { describe, expect, it } from "vitest";
import type { SnapshotPayload } from "./snapshotShared";
import {
  DEFAULT_COLUMNS, TAGS_PER_STOCK, TAGS_TOTAL, cleanTag, nextSort, parseColumns, parseTags, pruneTags, sortRows, tagCounts, toggleColumn, toggleTag,
  type RowFacts,
} from "./watchDashboard";

describe("dashboard columns", () => {
  it("keeps known columns in their fixed order and falls back to the defaults", () => {
    expect(parseColumns(["insiders", "quality", "bogus", 3, "quality"])).toEqual(["quality", "insiders"]);
    expect(parseColumns("nope")).toEqual(DEFAULT_COLUMNS);
    expect(parseColumns([])).toEqual([]); // the user may hide them all
    expect(toggleColumn(["quality"], "fairValue")).toEqual(["fairValue", "quality"]);
    expect(toggleColumn(["fairValue", "quality"], "fairValue")).toEqual(["quality"]);
  });
});

describe("tags", () => {
  it("cleans names and drops invalid, duplicate or excess tags", () => {
    expect(cleanTag("  Para   estudiar  ")).toBe("Para estudiar");
    expect(cleanTag("x".repeat(40))).toHaveLength(24);
    const many = Array.from({ length: TAGS_PER_STOCK + 3 }, (_, i) => `t${i}`);
    const tags = parseTags({ AAPL: ["Dividends", "dividends", "", 5, "Core"], msft: ["x"], KO: many, NVDA: "nope" });
    expect(tags).toEqual({ AAPL: ["Dividends", "Core"], KO: many.slice(0, TAGS_PER_STOCK) });
    expect(parseTags(["not", "an", "object"])).toEqual({});
  });

  it("uses one spelling per tag across stocks", () => {
    expect(parseTags({ AAPL: ["Core"], MSFT: ["core"] })).toEqual({ AAPL: ["Core"], MSFT: ["Core"] });
    expect(toggleTag({ AAPL: ["Core"] }, "MSFT", " CORE ")).toEqual({ AAPL: ["Core"], MSFT: ["Core"] });
  });

  it("toggles a tag on and off, dropping stocks left without tags", () => {
    let t = toggleTag({}, "AAPL", "Core");
    expect(t).toEqual({ AAPL: ["Core"] });
    t = toggleTag(t, "AAPL", "core");
    expect(t).toEqual({});
    expect(toggleTag({}, "AAPL", "   ")).toEqual({});
  });

  it("refuses a new tag past the limits instead of dropping another", () => {
    const full = { AAPL: Array.from({ length: TAGS_PER_STOCK }, (_, i) => `t${i}`) };
    expect(toggleTag(full, "AAPL", "one more")).toBe(full);
    const everywhere = Object.fromEntries(Array.from({ length: TAGS_TOTAL }, (_, i) => [`S${String.fromCharCode(65 + (i % 26))}${i >= 26 ? "X" : ""}`, [`tag${i}`]]));
    expect(toggleTag(everywhere, "AAPL", "brand new")).toBe(everywhere);
    expect(toggleTag(everywhere, "AAPL", "tag3")).toEqual({ ...everywhere, AAPL: ["tag3"] }); // an existing tag is fine
  });

  it("counts tags over the listed stocks and forgets stocks removed from the list", () => {
    const tags = { AAPL: ["Core", "Tech"], MSFT: ["Tech"], OLD: ["Tech"] };
    expect(tagCounts(tags, ["AAPL", "MSFT"])).toEqual([
      { tag: "Core", count: 1 },
      { tag: "Tech", count: 2 },
    ]);
    expect(pruneTags(tags, ["AAPL", "MSFT"])).toEqual({ AAPL: ["Core", "Tech"], MSFT: ["Tech"] });
    const same = { AAPL: ["Core"] };
    expect(pruneTags(same, ["AAPL"])).toBe(same);
  });
});

describe("sorting", () => {
  const snap = (passed: number, failed: number, filed: string | null, bought = 0, sold = 0): SnapshotPayload => ({
    symbol: "X",
    cik: 1,
    quality: { ok: true, data: { passed, failed, na: 0, level: "mixed", fiscal: "FY2025" } },
    filings: { ok: true, data: { report: null, latest: filed ? { accn: "a", form: "8-K", filed, reportDate: null, primaryDocument: "", items: [] } : null } },
    insiders: { ok: true, data: { from: "", to: "", bought, sold, buyers: 0, sellers: 0, pending: 0, checkedAt: "" } },
  });
  const row = (symbol: string, o: Partial<RowFacts> = {}): RowFacts => ({ symbol, price: 100, change: null, marketCap: null, fairValue: null, snapshot: null, ...o });
  const rows = [
    row("B", { change: 0.02, fairValue: 150, snapshot: snap(3, 6, "2026-10-01", 0, 5e6) }),
    row("A", { change: -0.01, fairValue: 90, snapshot: snap(8, 1, "2026-11-05", 2e6, 0) }),
    row("C", { change: null, snapshot: null }),
    row("D", { change: 0.02, fairValue: 120, price: null, snapshot: snap(0, 0, null) }),
  ];
  const order = (key: Parameters<typeof sortRows>[1], dir: "asc" | "desc") => sortRows(rows, key, dir).map((r) => r.symbol).join("");

  it("keeps the saved order (or reverses it) and sorts names A→Z", () => {
    expect(order("saved", "asc")).toBe("BACD");
    expect(order("saved", "desc")).toBe("DCAB");
    expect(order("symbol", "asc")).toBe("ABCD");
  });

  it("puts rows without a value last in both directions, ties by symbol", () => {
    expect(order("change", "desc")).toBe("BDAC");
    expect(order("change", "asc")).toBe("ABDC");
    expect(order("fairValue", "desc")).toBe("BACD"); // upside +50 %, −10 %; D has no price
    expect(order("quality", "desc")).toBe("ABCD"); // 8/9, 3/9; D judged nothing
    expect(order("latest", "desc")).toBe("ABCD"); // newest filing first
    expect(order("insiders", "desc")).toBe("ADBC"); // net bought: +2M, 0, −5M
  });

  it("first click sorts biggest or newest first, the second flips it", () => {
    expect(nextSort({ key: "saved", dir: "asc" }, "quality")).toEqual({ key: "quality", dir: "desc" });
    expect(nextSort({ key: "quality", dir: "desc" }, "quality")).toEqual({ key: "quality", dir: "asc" });
    expect(nextSort({ key: "quality", dir: "desc" }, "symbol")).toEqual({ key: "symbol", dir: "asc" });
  });
});
