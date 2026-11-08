import { beforeEach, describe, expect, it, vi } from "vitest";

const quote = vi.hoisted(() => ({ result: null as unknown }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/data", () => ({
  normalizeSymbol: (s: string) => (/^[A-Z]{1,5}$/i.test(s) ? s.toUpperCase() : null),
  getQuote: vi.fn(async () => quote.result),
  getStockSections: vi.fn(() => ({ source: "FMP" })),
}));
vi.mock("@/components/StockView", () => ({ default: () => null }));
vi.mock("@/components/DataUnavailable", () => ({ default: () => null }));

import StockPage from "./page";
import StockView from "@/components/StockView";
import DataUnavailable from "@/components/DataUnavailable";

const run = (ticker: string) => StockPage({ params: Promise.resolve({ ticker }) });

beforeEach(() => {
  quote.result = null;
});

describe("stock page status", () => {
  it("answers 404 for an invalid or unknown ticker, before anything streams", async () => {
    await expect(run("123")).rejects.toThrow("NEXT_NOT_FOUND");
    quote.result = { ok: false, error: "not_found" };
    await expect(run("ZZZZ")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("tells a provider outage apart from an unknown ticker", async () => {
    quote.result = { ok: false, error: "rate_limited" };
    const el = (await run("AAPL")) as { type: unknown; props: { issue: string } };
    expect(el.type).toBe(DataUnavailable);
    expect(el.props.issue).toBe("rate_limited");
  });

  it("renders the page with the quote and the streaming sections", async () => {
    quote.result = { ok: true, fetchedAt: "t", data: { symbol: "AAPL", name: "Apple", price: 1, change: 0, changePercent: 0 } };
    const el = (await run("aapl")) as { type: unknown; props: { quote: { symbol: string } } };
    expect(el.type).toBe(StockView);
    expect(el.props.quote.symbol).toBe("AAPL");
  });
});
