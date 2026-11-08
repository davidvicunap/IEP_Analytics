import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { form4XmlUrl, parseForm4, roleOf, summarize, type InsiderTx } from "./form4";

const fixture = (name: string) => readFileSync(`src/lib/__fixtures__/form4/${name}`, "utf8");

describe("parseForm4 (real filings)", () => {
  it("reads a 10b5-1 sale with its owner, price and holdings after", () => {
    const [t] = parseForm4(fixture("aapl-sale-10b5-1.xml"), "0001140361-26-042149");
    expect(t).toMatchObject({
      ownerName: "Newstead Jennifer",
      ownerCik: 1780525,
      isOfficer: true,
      officerTitle: "SVP, GC and Government Affairs",
      date: "2026-11-03",
      code: "S",
      acquired: false,
      shares: 2399,
      price: 325.75,
      ownedAfter: 29997,
      direct: true,
      planned: true,
    });
  });

  it("keeps every non-derivative row of a mixed filing and ignores the derivative table", () => {
    const txs = parseForm4(fixture("aapl-exercise-sale-gift.xml"), "0001140361-26-038674");
    expect(txs.map((t) => t.code)).toEqual(["M", "F", "S", "S", "S", "S", "G"]);
    expect(txs.map((t) => t.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(txs.filter((t) => t.code === "S").every((t) => t.planned)).toBe(true);
    expect(txs.every((t) => t.direct)).toBe(true); // the trust appears as a holding, not a transaction
  });

  it("reads 1/0 flags (other filing agents) and director-only owners", () => {
    const [t] = parseForm4(fixture("jpm-grant.xml"), "0001225208-26-006277");
    expect(t).toMatchObject({ code: "A", acquired: true, isDirector: true, isOfficer: false, planned: false });
    expect(roleOf(t)).toBe("director");
  });

  it("marks a sale as planned from its footnote when the 2023 checkbox is absent", () => {
    const old = fixture("aapl-sale-10b5-1.xml").replace("<aff10b5One>true</aff10b5One>", "");
    expect(parseForm4(old, "x")[0].planned).toBe(true);
    const notPlanned = old.replace(
      "This transaction was made pursuant to a Rule 10b5-1 trading plan",
      "This transaction was not made pursuant to a Rule 10b5-1 trading plan",
    );
    expect(parseForm4(notPlanned, "x")[0].planned).toBe(false);
  });

  it("rejects documents that aren't Form 4 XML", () => {
    expect(() => parseForm4("<html><body>Not found</body></html>", "x")).toThrow();
  });

  it("builds the raw XML URL from the XSL view path", () => {
    expect(form4XmlUrl(320193, "0001140361-26-042149", "xslF345X06/form4.xml")).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000114036126042149/form4.xml",
    );
  });
});

describe("summarize", () => {
  const base: InsiderTx = {
    accn: "a", seq: 0, ownerCik: 1, ownerName: "Ann CEO", otherOwners: 0, isDirector: false, isOfficer: true, isTenPct: false,
    officerTitle: "CEO", date: "2026-06-01", code: "S", acquired: false, shares: 100, price: 50, ownedAfter: 1000, direct: true,
    planned: false, security: "Common Stock",
  };
  const txs: InsiderTx[] = [
    base, // discretionary sale 5,000
    { ...base, seq: 1, planned: true, shares: 200 }, // planned sale 10,000
    { ...base, accn: "b", ownerCik: 2, ownerName: "Bob Director", isOfficer: false, isDirector: true, officerTitle: null, code: "P", acquired: true, shares: 40, price: 50 }, // purchase 2,000
    { ...base, accn: "c", code: "A", acquired: true, price: null }, // grant: other
    { ...base, accn: "d", code: "F", price: 50 }, // tax withholding: other
    { ...base, accn: "e", date: "2025-10-01", code: "P", acquired: true }, // outside the window
  ];
  const s = summarize(txs, "2026-11-07");

  it("splits purchases, discretionary and planned sales over 12 months", () => {
    expect(s.from).toBe("2025-11-07");
    expect(s.purchases).toEqual({ count: 1, insiders: 1, shares: 40, value: 2000 });
    expect(s.sales).toEqual({ count: 1, insiders: 1, shares: 100, value: 5000 });
    expect(s.plannedSales).toEqual({ count: 1, insiders: 1, shares: 200, value: 10000 });
    expect(s.net).toBe(2000 - 5000 - 10000);
    expect(s.otherCount).toBe(2);
  });

  it("totals per person, most active first", () => {
    expect(s.people.map((p) => [p.name, p.role, p.bought, p.sold, p.planned])).toEqual([
      ["Ann CEO", "officer", 0, 5000, 10000],
      ["Bob Director", "director", 2000, 0, 0],
    ]);
  });
});
