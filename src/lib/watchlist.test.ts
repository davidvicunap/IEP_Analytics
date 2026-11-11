import { describe, expect, it } from "vitest";
import { insertAt, sanitizeList } from "./watchlist";

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
});
