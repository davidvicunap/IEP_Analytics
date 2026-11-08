import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfig, writeConfig } from "./chartConfig";

const parse = (q: string) => parseConfig(new URLSearchParams(q));

describe("chart URL state", () => {
  it("opens with a default chart when the URL is empty", () => {
    expect(parse("")).toEqual(DEFAULT_CONFIG);
  });

  it("round-trips a chart through the URL", () => {
    const c = { symbols: ["NVDA", "BRK.B"], metrics: ["pe" as const, "ps" as const], freq: "monthly" as const, transform: "index" as const, kind: "line" as const, range: 60 };
    const q = writeConfig(c);
    expect(q).toBe("s=NVDA,BRK.B&m=pe,ps&f=monthly&t=index&k=line&r=60");
    expect(parse(q)).toEqual(c);
  });

  it("cleans up symbols: case, duplicates, junk and the 5-company cap", () => {
    expect(parse("s=aapl,AAPL,<x>,msft,goog,amzn,meta,nflx&m=revenue").symbols).toEqual(["AAPL", "MSFT", "GOOG", "AMZN", "META"]);
  });

  it("drops metrics that don't exist or don't fit the frequency", () => {
    expect(parse("s=AAPL&m=revenue,hack,pe&f=annual").metrics).toEqual(["revenue"]);
    expect(parse("s=AAPL&m=revenue&f=monthly").metrics).toEqual(["pe"]);
    expect(parse("s=AAPL&m=roe&f=quarterly").metrics).toEqual(["revenue"]);
  });

  it("keeps only same-unit metrics when values are shown", () => {
    expect(parse("s=AAPL&m=revenue,netMargin,netIncome").metrics).toEqual(["revenue", "netIncome"]);
    expect(parse("s=AAPL&m=revenue,netMargin&t=growth").metrics).toEqual(["revenue", "netMargin"]);
  });

  it("falls back to a valid range and a sensible chart type", () => {
    const c = parse("s=AAPL&m=revenue&f=quarterly&r=7");
    expect(c.range).toBe(12);
    expect(c.kind).toBe("line");
    expect(parse("s=AAPL&m=revenue&f=annual").kind).toBe("bar");
  });
});
