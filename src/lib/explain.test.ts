import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptExplanation, buildFacts, factsHash, systemPrompt, userPrompt, type FactInput } from "./explain";

// The data loaders are replaced: these tests never touch the SEC, a database or Claude.
vi.mock("./verdictData", () => ({ getVerdict: vi.fn() }));
vi.mock("./financials", () => ({ getFinancials: vi.fn() }));
vi.mock("./quarterReview", async (orig) => ({ ...(await orig<typeof import("./quarterReview")>()), quarterReview: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => null }));
vi.mock("./quota", () => ({ providerCallsToday: vi.fn(async () => 0), providerDailyLimit: () => 40, recordProviderCall: vi.fn(async () => 1) }));

const { getVerdict } = await import("./verdictData");
const { getFinancials } = await import("./financials");
const { quarterReview } = await import("./quarterReview");
const { getExplanation } = await import("./explainData");

const input: FactInput = {
  symbol: "AAPL",
  name: "Apple Inc.",
  cik: 320193,
  verdict: {
    fiscal: "FY2025",
    industry: "ELECTRONIC COMPUTERS",
    points: [
      { key: "quality", level: "good", passed: 9, judged: 10 },
      { key: "growth", level: "mid", metric: "revenueGrowth", value: 0.064, compare: 0.05 },
      { key: "valuation", level: "weak", metric: "pe", value: 34.2, compare: 27.1 },
    ],
  },
  quarter: {
    quarter: "2026-Q3",
    label: "Q4 FY2026",
    end: "2026-09-27",
    yearAgoLabel: "Q4 FY2025",
    priorLabel: "Q3 FY2026",
    filing: { accn: "0000320193-26-000105", form: "10-K", filed: "2026-10-31" },
    rows: [
      { key: "revenue", now: 102.5e9, yearAgo: 94.9e9, prior: 94e9, vsYearAgo: 0.08, vsPrior: 0.09 },
      { key: "grossMargin", now: 0.47, yearAgo: 0.462, prior: 0.466, vsYearAgo: 0.008, vsPrior: 0.004 },
      { key: "freeCashFlow", now: null, yearAgo: null, prior: null, vsYearAgo: null, vsPrior: null },
    ],
  },
};

describe("the fact sheet", () => {
  it("numbers each figure with its source, in the reader's language", () => {
    const es = buildFacts(input, "es");
    expect(es.map((f) => f.id)).toEqual(["F1", "F2", "F3", "F4", "F5"]);
    expect(es[0]).toEqual({
      id: "F1",
      label: "Ingresos · Q4 FY2026",
      value: "$102.5B (+8% frente a Q4 FY2025)",
      source: "10-K presentado el 2026-10-31",
      href: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000105/",
    });
    expect(es[1].value).toBe("47% (+0.8 pts frente a Q4 FY2025)");
    expect(es[2]).toMatchObject({ label: "Pruebas de calidad (Buffett) superadas", value: "9 de 10 (bien)", source: "10-K FY2025" });
    expect(es[4]).toMatchObject({ value: "34.2x / 27.1x (débil)", source: "precio de Financial Modeling Prep y cifras de la SEC" });
    expect(buildFacts(input, "en")[3]).toMatchObject({ label: "Revenue growth against its industry median", value: "6.4% / 5% (in line)", source: "10-K FY2025 · industry: ELECTRONIC COMPUTERS" });
  });

  it("changes its fingerprint when a figure or the language changes", () => {
    const a = buildFacts(input, "es");
    expect(factsHash(a, "es")).toBe(factsHash(buildFacts(input, "es"), "es"));
    expect(factsHash(a, "es")).not.toBe(factsHash(buildFacts(input, "en"), "en"));
    const later = { ...input, quarter: { ...input.quarter!, filing: { ...input.quarter!.filing!, filed: "2027-01-30" } } };
    expect(factsHash(buildFacts(later, "es"), "es")).not.toBe(factsHash(a, "es"));
  });

  it("asks for cited, educational writing in the right language", () => {
    expect(systemPrompt("es")).toMatch(/Spanish/);
    expect(systemPrompt("en")).toMatch(/never tell the reader to buy, sell or hold/);
    expect(userPrompt("AAPL", "Apple Inc.", buildFacts(input, "en"))).toContain("F1. Revenue · Q4 FY2026: $102.5B (+8% vs Q4 FY2025) — 10-K filed on 2026-10-31");
  });
});

describe("what is accepted back", () => {
  it("keeps only points that cite facts we gave, without ids in the text", () => {
    const facts = buildFacts(input, "en");
    const out = acceptExplanation(
      {
        quarter: [
          { text: "Revenue grew 8% from a year earlier [F1].", facts: ["f1", "F1"] },
          { text: "Services hit a record.", facts: ["F99"] },
          { text: "No source here.", facts: [] },
        ],
        bull: [{ text: "It passes 9 of 10 quality tests (F3).", facts: ["F3"] }],
        bear: Array.from({ length: 6 }, (_, i) => ({ text: `Point ${i}`, facts: ["F5"] })),
      },
      facts,
    );
    expect(out.quarter).toEqual([{ text: "Revenue grew 8% from a year earlier.", facts: ["F1"] }]);
    expect(out.bull).toEqual([{ text: "It passes 9 of 10 quality tests.", facts: ["F3"] }]);
    expect(out.bear).toHaveLength(4);
  });
});

describe("writing once per set of facts", () => {
  const memory = () => {
    const m = new Map<string, unknown>();
    return {
      get: vi.fn(async (s: string, l: string, h: string) => (m.get(`${s}|${l}|${h}`) as never) ?? null),
      put: vi.fn(async (s: string, l: string, h: string, v: unknown) => void m.set(`${s}|${l}|${h}`, v)),
    };
  };
  beforeEach(() => {
    vi.mocked(getVerdict).mockResolvedValue({ ok: true, fetchedAt: "x", data: { symbol: "AAPL", points: input.verdict!.points, missing: [], fiscal: "FY2025", industry: "ELECTRONIC COMPUTERS", priceAt: null, historyFrom: null, issues: {} } });
    vi.mocked(getFinancials).mockResolvedValue({ ok: true, fetchedAt: "x", data: { cik: 320193, quarterly: {}, shares: { splits: [] } } } as never);
    vi.mocked(quarterReview).mockReturnValue(input.quarter);
  });

  it("reads without writing, writes on request, then serves the stored one", async () => {
    const store = memory();
    const writer = vi.fn(async () => ({ ok: true as const, fetchedAt: "x", data: { quarter: [{ text: "Revenue grew.", facts: ["F1"] }], bull: [], bear: [] } }));
    const first = await getExplanation("AAPL", "en", { write: false, writer, store });
    expect(first.ok && first.data).toMatchObject({ explanation: null, canGenerate: true });
    expect(writer).not.toHaveBeenCalled();
    const written = await getExplanation("AAPL", "en", { write: true, writer, store });
    expect(written.ok && written.data.explanation?.quarter[0].text).toBe("Revenue grew.");
    const again = await getExplanation("AAPL", "en", { write: true, writer, store });
    expect(again.ok && again.data.generatedAt).toBe(written.ok && written.data.generatedAt);
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it("says when it's off, and when there's too little to explain", async () => {
    const store = memory();
    delete process.env.ANTHROPIC_API_KEY;
    const off = await getExplanation("AAPL", "en", { write: true, store });
    expect(off.ok && off.data).toMatchObject({ explanation: null, canGenerate: false, why: "not_configured" });
    vi.mocked(getVerdict).mockResolvedValue({ ok: false, error: "not_found" });
    vi.mocked(quarterReview).mockReturnValue(null);
    expect(await getExplanation("AAPL", "en", { write: false, store })).toEqual({ ok: false, error: "not_found" });
  });

  it("passes on a failed write without storing anything", async () => {
    const store = memory();
    const writer = vi.fn(async () => ({ ok: false as const, error: "upstream" as const }));
    expect(await getExplanation("AAPL", "es", { write: true, writer, store })).toEqual({ ok: false, error: "upstream" });
    expect(store.put).not.toHaveBeenCalled();
  });
});
