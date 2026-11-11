import { beforeEach, describe, expect, it, vi } from "vitest";

const page = vi.hoisted(() => ({ result: null as unknown }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/data", () => ({
  normalizeSymbol: (s: string) => (/^[A-Z]{1,5}$/i.test(s) ? s.toUpperCase() : null),
  getStockPage: vi.fn(async () => page.result),
  getStockSections: vi.fn(() => ({ source: "FMP" })),
}));
vi.mock("@/components/StockView", () => ({ default: () => null }));
vi.mock("@/components/DataUnavailable", () => ({ default: () => null }));

import StockPage from "./page";
import StockView from "@/components/StockView";
import DataUnavailable from "@/components/DataUnavailable";

const run = (ticker: string) => StockPage({ params: Promise.resolve({ ticker }) });

beforeEach(() => {
  page.result = null;
});

describe("stock page status", () => {
  it("answers 404 for an invalid or unknown ticker, before anything streams", async () => {
    await expect(run("123")).rejects.toThrow("NEXT_NOT_FOUND");
    page.result = { kind: "not_found" };
    await expect(run("ZZZZ")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("tells a provider outage apart from an unknown ticker", async () => {
    page.result = { kind: "unavailable", issue: "rate_limited" };
    const el = (await run("AAPL")) as { type: unknown; props: { issue: string } };
    expect(el.type).toBe(DataUnavailable);
    expect(el.props.issue).toBe("rate_limited");
  });

  it("renders the page with the quote and the streaming sections", async () => {
    const quote = { symbol: "AAPL", name: "Apple", price: 1, change: 0, changePercent: 0 };
    page.result = { kind: "ok", identity: { symbol: "AAPL", name: "Apple" }, quote, fetchedAt: "t", priceIssue: null };
    const el = (await run("aapl")) as { type: unknown; props: { quote: { symbol: string }; identity: { symbol: string } } };
    expect(el.type).toBe(StockView);
    expect(el.props.identity.symbol).toBe("AAPL");
    expect(el.props.quote.symbol).toBe("AAPL");
  });

  it("opens a company with no price at all, saying why", async () => {
    page.result = { kind: "ok", identity: { symbol: "HIMS", name: "Hims & Hers Health, Inc." }, quote: null, fetchedAt: null, priceIssue: "plan_restricted" };
    const el = (await run("HIMS")) as { type: unknown; props: { quote: unknown; priceIssue: string } };
    expect(el.type).toBe(StockView);
    expect(el.props.quote).toBeNull();
    expect(el.props.priceIssue).toBe("plan_restricted");
  });
});
