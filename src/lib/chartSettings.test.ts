import { describe, expect, it } from "vitest";
import { DEFAULT_CHART, chartHeight, parseChartSettings, visibleWindow, writeChartSettings } from "./chartSettings";

describe("chart settings in the URL", () => {
  it("round-trips and keeps default values out of the URL", () => {
    const s = { range: "6M" as const, style: "line" as const, inds: ["rsi" as const, "sma" as const] };
    const p = writeChartSettings(new URLSearchParams("tab=chart"), s);
    expect(p.toString()).toBe("tab=chart&range=6M&style=line&ind=sma%2Crsi");
    expect(parseChartSettings(p)).toEqual({ range: "6M", style: "line", inds: ["sma", "rsi"] });
    expect(writeChartSettings(new URLSearchParams(), DEFAULT_CHART).toString()).toBe("");
  });
  it("ignores unknown values instead of failing", () => {
    expect(parseChartSettings(new URLSearchParams("range=10Y&style=bars&ind=foo,macd"))).toEqual({ range: "1Y", style: "candles", inds: ["macd"] });
    expect(parseChartSettings(new URLSearchParams("ind="))).toMatchObject({ inds: [] });
  });
  it("shows the requested window, or everything there is", () => {
    expect(visibleWindow(1000, "1M")).toEqual({ from: 977.5, to: 999.5 });
    expect(visibleWindow(100, "1Y")).toEqual({ from: -0.5, to: 99.5 });
  });
  it("reserves room for each indicator pane", () => {
    expect(chartHeight(["sma"])).toContain("+ 0px");
    expect(chartHeight(["rsi", "macd"])).toContain("+ 220px");
  });
});
