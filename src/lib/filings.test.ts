import { describe, expect, it } from "vitest";
import { filingDocUrl, filingIndexUrl, formGroup, parseFilings, xbrlViewerUrl } from "./filings";

const recent = {
  accessionNumber: ["0000320193-26-000026", "0001140361-26-042149", "0000320193-26-000025", "bad"],
  form: ["10-K", "4", "8-K", ""],
  filingDate: ["2026-11-03", "2026-11-05", "2026-11-02", "2026-01-01"],
  reportDate: ["2026-09-26", "2026-11-03", "2026-11-02", ""],
  primaryDocument: ["aapl-20260926.htm", "xslF345X06/form4.xml", "aapl-20261030.htm", ""],
  primaryDocDescription: ["10-K", "PRIMARY DOCUMENT", "8-K", ""],
  items: ["", "", "2.02,9.01", ""],
  isInlineXBRL: [1, 0, 1, 0],
};

describe("filings", () => {
  const list = parseFilings(recent);
  it("parses, drops incomplete rows and sorts newest first", () => {
    expect(list.map((f) => f.form)).toEqual(["4", "10-K", "8-K"]);
    expect(list[2]).toMatchObject({ items: ["2.02", "9.01"], inlineXbrl: true, reportDate: "2026-11-02" });
  });
  it("groups forms the way investors look for them", () => {
    expect(["10-K", "10-K/A", "20-F", "10-Q", "8-K", "DEF 14A", "4", "144", "SC 13G/A", "SCHEDULE 13G/A", "424B2", "S-8", "CORRESP"].map(formGroup)).toEqual([
      "annual", "annual", "annual", "quarterly", "current", "proxy", "insiders", "insiders", "ownership", "ownership", "registration", "registration", "other",
    ]);
  });
  it("builds document, index and XBRL viewer links", () => {
    const k = list[1];
    expect(filingDocUrl(320193, k)).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm");
    expect(filingIndexUrl(320193, k.accn)).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/0000320193-26-000026-index.htm");
    expect(xbrlViewerUrl(320193, k)).toBe("https://www.sec.gov/ix?doc=/Archives/edgar/data/320193/000032019326000026/aapl-20260926.htm");
    expect(filingDocUrl(320193, { accn: "0000320193-26-000001", primaryDocument: "" })).toContain("-index.htm");
  });
});
