import { describe, expect, it } from "vitest";
import { MAX_STUDIES, parseStudies, toggleStudy, widgetStudies } from "./chartStudies";

describe("saved chart indicators", () => {
  it("keeps known ones once, in catalog order, up to the limit", () => {
    expect(parseStudies(["rsi", "sma", "rsi", "bogus", 3])).toEqual(["sma", "rsi"]);
    expect(parseStudies(["sma", "ema", "bb", "vwap", "rsi", "macd"])).toHaveLength(MAX_STUDIES);
    expect(parseStudies("sma")).toEqual([]);
  });
  it("toggles, refusing one past the limit", () => {
    expect(toggleStudy(["sma"], "rsi")).toEqual(["sma", "rsi"]);
    expect(toggleStudy(["sma", "rsi"], "sma")).toEqual(["rsi"]);
    const full = parseStudies(["sma", "ema", "bb", "vwap", "rsi"]);
    expect(toggleStudy(full, "macd")).toEqual(full);
  });
  it("maps to TradingView's ids", () => {
    expect(widgetStudies(["sma", "macd"])).toEqual(["MASimple@tv-basicstudies", "MACD@tv-basicstudies"]);
  });
});
