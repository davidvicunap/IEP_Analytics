import { describe, expect, it } from "vitest";
import { bestIndex, compareHref, parseCompare } from "./compare";

describe("compare", () => {
  it("reads up to four tickers from the URL, in order, without repeats", () => {
    expect(parseCompare("aapl,MSFT msft,googl")).toEqual(["AAPL", "MSFT", "GOOGL"]);
    expect(parseCompare("BRK-B,KO")).toEqual(["BRK-B", "KO"]);
    expect(parseCompare("A,B,C,D,E")).toEqual(["A", "B", "C", "D"]);
    expect(parseCompare("1x,,$$,KO")).toEqual(["KO"]);
    expect(parseCompare(null)).toEqual([]);
  });

  it("builds a shareable link", () => {
    expect(compareHref(["AAPL", "BRK.B"])).toBe("/compare?s=AAPL,BRK.B");
    expect(compareHref([])).toBe("/compare");
  });

  it("marks the best value only when there is something to compare and no tie", () => {
    expect(bestIndex([0.1, 0.3, null, 0.2], "higher")).toBe(1);
    expect(bestIndex([0.5, 0.3, 0.9], "lower")).toBe(1);
    expect(bestIndex([0.3, 0.3], "higher")).toBeNull();
    expect(bestIndex([0.3, null], "higher")).toBeNull();
  });
});
