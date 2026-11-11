import { describe, expect, it } from "vitest";
import {
  chunks, cleanRow, compareRisks, decodeEntities, findSections, htmlToBlocks, itemOf, markRisks, riskTitles, similarity, truncateSection, wordCount, words,
  type Block,
} from "./filingReader";

const filler = (topic: string, n = 12) => Array.from({ length: n }, (_, i) => `<div><span style="font-weight:400">${topic} paragraph ${i}: ${"lorem ipsum dolor sit amet ".repeat(4)}</span></div>`).join("");
const footer = (page: number) => `<div style="text-align:center"><span>Acme Corp. | 2026 Form 10-K | ${page}</span></div>`;
const bold = (t: string) => `<div><span style="font-weight:700;font-style:italic">${t}</span></div>`;

// A small 10-K with what real ones have: hidden XBRL header, a table of contents, page
// footers, cross-references, split headings, layout tables and a table of figures.
const tenK = (risks: string[]) => `<html><head><title>10-K</title><style>.x{}</style></head><body>
<div style="display:none"><ix:header><ix:hidden>dei:Secret 123</ix:hidden></ix:header></div>
<table>
  <tr><td>Item 1.</td><td><a href="#b">Business</a></td><td>3</td></tr>
  <tr><td>Item 1A.</td><td>Risk Factors</td><td>9</td></tr>
  <tr><td>Item 7.</td><td>Management&#8217;s Discussion and Analysis</td><td>20</td></tr>
</table>
<div><span>Forward-looking statements are discussed in Part I, Item 1A of this Form 10-K under the heading Risk Factors.</span></div>
<div><span style="font-weight:700">Item 1.&#160;&#160;&#160;&#160;Business</span></div>
${filler("Business", 6)}
<table><tr><td>&#8226;</td><td>iPhone &amp; Mac</td></tr><tr><td>&#8226;</td><td>Services</td></tr></table>
${footer(4)}${filler("More business", 6)}${footer(5)}
<table><tr><td><span style="font-weight:700">Item 1A.</span></td><td><span style="font-weight:700">Risk Factors</span></td></tr></table>
${filler("Risk intro", 1)}
${bold("Risks Related to Our Business")}
${risks.map((r, i) => `${bold(r)}${filler(`Risk ${i}`, 3)}`).join("")}
${footer(6)}${footer(7)}
<div><b>Item 1B. Unresolved Staff Comments</b></div><div>None.</div>
<div><span style="font-weight:700">ITEM 7. MANAGEMENT&#8217;S DISCUSSION AND ANALYSIS</span></div>
${filler("MD&amp;A", 8)}
<table>
  <tr><td></td><td>2026</td><td></td><td>2025</td></tr>
  <tr><td>Net sales</td><td>$</td><td>416,161</td><td>$</td><td>391,035</td></tr>
  <tr><td>Change</td><td>6</td><td>%</td><td>(2</td><td>)%</td></tr>
</table>
<div><b>Item 8. Financial Statements</b></div>${filler("Statements", 3)}
</body></html>`;

const RISKS = [
  "The Company’s results depend on global and regional economic conditions.",
  "The Company faces substantial competition in markets with rapid technological change.",
  "The Company depends on component suppliers, many of which are outside the U.S.",
  "Changes in tax rates and new tax legislation could affect the Company’s results.",
];

describe("filing HTML to blocks", () => {
  const blocks = htmlToBlocks(tenK(RISKS));
  const texts = blocks.filter((b): b is Extract<Block, { k: "p" }> => b.k === "p").map((b) => b.t);

  it("skips hidden XBRL, scripts and styles; decodes entities", () => {
    expect(texts.join(" ")).not.toContain("Secret");
    expect(texts.join(" ")).not.toContain(".x{}");
    expect(decodeEntities("A&#160;B &amp; C&#8217;s &mdash; &bogus; &#x2019;")).toBe("A B & C’s — &bogus; ’");
  });

  it("turns layout tables into paragraphs and keeps tables of figures, cleaned", () => {
    expect(texts).toContain("• iPhone & Mac");
    const table = blocks.find((b) => b.k === "table" && b.rows.flat().includes("Net sales"));
    expect(table).toEqual({ k: "table", rows: [["2026", "2025"], ["Net sales", "$416,161", "$391,035"], ["Change", "6%", "(2)%"]] });
    expect(cleanRow(["", "$", "1,234", "(5", ")", "  "])).toEqual(["$1,234", "(5)"]);
  });

  it("drops running page footers but keeps item headings", () => {
    expect(texts.some((t) => t.includes("Form 10-K |"))).toBe(false);
    expect(texts).toContain("Item 1A. Risk Factors");
  });

  it("marks bold or italic paragraphs as titles", () => {
    const title = blocks.find((b) => b.k === "p" && b.t === RISKS[0]);
    expect(title).toMatchObject({ e: true });
    expect(blocks.find((b) => b.k === "p" && b.t.startsWith("Business paragraph 0"))).not.toHaveProperty("e");
  });
});

describe("sections", () => {
  const s = findSections(htmlToBlocks(tenK(RISKS)));

  it("recognizes item headings, not references to them", () => {
    expect(itemOf({ k: "p", t: "ITEM 7. MANAGEMENT’S DISCUSSION AND ANALYSIS" })).toBe("7");
    expect(itemOf({ k: "p", t: "Part II, Item 1A. Risk Factors" })).toBe("1a");
    expect(itemOf({ k: "p", t: "Item 1A of this Form 10-K under the heading" })).toBeNull();
    expect(itemOf({ k: "p", t: `Item 1 ${"x".repeat(200)}` })).toBeNull();
  });

  it("finds each section in the body, not in the table of contents", () => {
    expect(s.business?.blocks[0]).toMatchObject({ t: expect.stringContaining("Business paragraph 0") });
    expect(s.business?.blocks.at(-1)).toMatchObject({ t: expect.stringContaining("More business paragraph 5") });
    expect(s.risks?.blocks[0]).toMatchObject({ t: expect.stringContaining("Risk intro") }); // the split "Risk Factors" heading is dropped
    expect(s.risks?.blocks.some((b) => b.k === "p" && b.t.includes("Unresolved"))).toBe(false); // ends at Item 1B
    expect(s.mdna?.blocks.some((b) => b.k === "table")).toBe(true);
    expect(s.mdna?.blocks.some((b) => b.k === "p" && b.t.includes("Statements"))).toBe(false); // ends at Item 8
  });

  it("returns nothing for a section that isn't there", () => {
    expect(findSections(htmlToBlocks(`<div>Item 1. Business</div>${filler("x", 1)}`)).risks).toBeNull();
  });

  it("cuts very long sections at a whole block and says so", () => {
    const sec = s.business!;
    const cut = truncateSection(sec, 300);
    expect(cut.truncated).toBe(true);
    expect(cut.blocks.length).toBeLessThan(sec.blocks.length);
    expect(truncateSection(sec)).toBe(sec);
  });

  it("counts words and groups text under its titles", () => {
    const blocks: Block[] = [{ k: "p", t: "Intro text here." }, { k: "p", t: "A title.", e: true }, { k: "p", t: "Body one two." }];
    expect(wordCount(blocks)).toBe(8);
    expect(chunks(blocks).map((c) => [c.title?.t ?? null, c.body.length])).toEqual([[null, 1], ["A title.", 1]]);
  });
});

describe("risk factor comparison", () => {
  it("takes risk titles, leaving category headings out", () => {
    const s = findSections(htmlToBlocks(tenK(RISKS)));
    expect(riskTitles(s.risks)).toEqual(RISKS);
  });

  it("counts a title that only gained a clause as reworded, not new", () => {
    const a = words("The Company’s operations depend significantly on global and regional economic conditions.");
    const b = words("The Company’s operations depend significantly on global and regional economic conditions and adverse changes could hurt results.");
    expect(similarity(a, b)).toBeGreaterThan(0.55);
    expect(similarity(words("Our stock price is volatile."), words("We depend on key suppliers in Asia."))).toBeLessThan(0.2);
  });

  it("sorts this year's titles into same, reworded and new, and finds removed ones", () => {
    const before = [RISKS[0], RISKS[1], "The Company depends on component suppliers outside the U.S.", "Our business could suffer from pandemics such as COVID-19 and related restrictions."];
    const now = [RISKS[0].toUpperCase(), RISKS[1], RISKS[2], "Issues related to artificial intelligence may result in reputational and financial harm."];
    const d = compareRisks(now, before);
    expect(d.same).toBe(2); // case and punctuation don't matter
    expect(d.changed).toEqual([{ now: RISKS[2], before: before[2] }]);
    expect(d.added).toEqual([now[3]]);
    expect(d.removed).toEqual([before[3]]);
    expect(d.total).toBe(4);
  });

  it("flags new and reworded titles in the text", () => {
    const s = findSections(htmlToBlocks(tenK(RISKS))).risks!;
    const marked = markRisks(s, { added: [RISKS[3]], changed: [{ now: RISKS[2], before: "x" }], removed: [], same: 2, total: 4, totalBefore: 3 });
    const mark = (t: string) => marked.blocks.find((b) => b.k === "p" && b.t === t) as { mark?: string };
    expect(mark(RISKS[3]).mark).toBe("new");
    expect(mark(RISKS[2]).mark).toBe("changed");
    expect(mark(RISKS[0]).mark).toBeUndefined();
  });
});
