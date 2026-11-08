import { describe, expect, it } from "vitest";
import { insertAt, sanitizeList } from "./watchlist";
import { sortItems } from "./watchlistSort";

describe("saved lists", () => {
  it("keeps valid, unique, uppercase tickers and drops anything else", () => {
    expect(sanitizeList(["aapl", "AAPL", " msft ", 42, null, "BRK.B", "1BAD", "<script>", "TOOLONGTICKER"])).toEqual(["AAPL", "MSFT", "BRK.B"]);
    expect(sanitizeList({ not: "a list" })).toEqual([]);
  });
  it("puts a removed symbol back where it was (undo)", () => {
    expect(insertAt(["A", "C"], "B", 1)).toEqual(["A", "B", "C"]);
    expect(insertAt(["A", "B"], "B")).toEqual(["A", "B"]); // no duplicates
  });
  it("keeps every saved symbol beyond the old 30-symbol request cap", () => {
    const big = Array.from({ length: 45 }, (_, i) => `T${String.fromCharCode(65 + (i % 26))}${i >= 26 ? "X" : ""}`);
    expect(sanitizeList(big)).toHaveLength(45);
  });
  it("sorts by daily change with missing prices last", () => {
    const q = (symbol: string, changePercent?: number) => ({ symbol, quote: changePercent === undefined ? undefined : { symbol, name: symbol, price: 1, change: 0, changePercent } });
    const rows = [q("A", -1), q("B"), q("C", 3)];
    expect(sortItems(rows, "changeDesc").map((r) => r.symbol)).toEqual(["C", "A", "B"]);
    expect(sortItems(rows, "changeAsc").map((r) => r.symbol)).toEqual(["A", "C", "B"]);
    expect(sortItems(rows, "saved")).toBe(rows);
  });
});
