import { describe, expect, it } from "vitest";
import { commandsFor, hrefFor, normalize, parse, type Command, type Context } from "./commands";

const ctx = (over: Partial<Context> = {}): Context => ({ recent: [], following: [], results: [], ...over });
const hrefs = (cs: Command[]) => cs.map((c) => (c.type === "stock" ? hrefFor(c) : c.type === "page" ? `page:${c.page}` : c.type === "setting" ? `set:${c.setting}` : `${c.on ? "follow" : "unfollow"}:${c.symbol}`));

describe("reading a line", () => {
  it("ignores case and accents", () => {
    expect(normalize("  AAPL   Valoración ")).toBe("aapl valoracion");
  });

  it("finds the section and the company in any order, in both languages", () => {
    expect(parse("aapl valoración")).toMatchObject({ section: "valuation", rest: "aapl" });
    expect(parse("dcf msft")).toMatchObject({ section: "dcf", rest: "msft" });
    expect(parse("insiders apple")).toMatchObject({ section: "insiders", rest: "apple" });
    expect(parse("NVDA estados")).toMatchObject({ section: "statements", rest: "nvda" });
    expect(parse("seguir ko")).toMatchObject({ action: "follow", rest: "ko" });
    expect(parse("aapl")).toMatchObject({ section: null, action: null, rest: "aapl" });
  });

  it("prefers whole keywords to abbreviations, and keeps a lone abbreviation open to being a ticker", () => {
    expect(parse("dis dcf")).toMatchObject({ section: "dcf", rest: "dis" });
    expect(parse("val msft")).toMatchObject({ section: "valuation", rest: "msft" });
    expect(parse("dis")).toEqual({ section: "dcf", action: null, rest: "", alt: "dis" });
    expect(parse("news").alt).toBeUndefined();
  });

  it("keeps a ticker beside an action, even one that starts a section word", () => {
    expect(parse("follow dis")).toMatchObject({ action: "follow", section: null, rest: "dis" });
    expect(parse("dis seguir")).toMatchObject({ action: "follow", section: null, rest: "dis" });
    expect(hrefs(commandsFor("follow dis", ctx({ symbol: "MSFT" })))).toEqual(["follow:DIS"]);
  });
});

describe("commands for a line", () => {
  it("suggests the stock on screen, recent stocks and main pages with nothing typed", () => {
    expect(hrefs(commandsFor("", ctx({ symbol: "AAPL", recent: ["MSFT", "KO"] })))).toEqual([
      "/stock/AAPL?tab=valuation",
      "/stock/AAPL?tab=research",
      "/stock/AAPL?tab=business&view=income",
      "/stock/AAPL?tab=filings&view=insiders",
      "/stock/MSFT",
      "/stock/KO",
      "page:canvas",
      "page:watchlist",
    ]);
  });

  it("opens a typed ticker at once and adds search matches, followed stocks first", () => {
    const results = [
      { symbol: "APLE", name: "Apple Hospitality" },
      { symbol: "AAPL", name: "Apple Inc." },
    ];
    expect(hrefs(commandsFor("apple valoracion", ctx({ results, following: ["AAPL"] })))).toEqual(["/stock/AAPL?tab=valuation", "/stock/APLE?tab=valuation"]);
    expect(hrefs(commandsFor("aapl", ctx()))).toEqual(["/stock/AAPL"]);
    expect(hrefs(commandsFor("nvda 10-k", ctx()))).toEqual(["/stock/NVDA/report"]);
  });

  it("uses the stock on screen when only a section or an action is typed", () => {
    expect(hrefs(commandsFor("dcf", ctx({ symbol: "MSFT" })))).toEqual(["/stock/MSFT?tab=valuation&view=dcf"]);
    expect(hrefs(commandsFor("seguir", ctx({ symbol: "KO" })))).toEqual(["follow:KO"]);
    expect(hrefs(commandsFor("dejar de seguir ko", ctx()))).toEqual(["unfollow:KO"]);
    expect(hrefs(commandsFor("de", ctx()))).toEqual(["/stock/DE"]); // alone, a little word is a ticker (Deere)
    // "dis" on a stock page: its DCF, or Disney.
    expect(hrefs(commandsFor("dis", ctx({ symbol: "MSFT" })))).toEqual(["/stock/MSFT?tab=valuation&view=dcf", "/stock/DIS"]);
  });

  it("offers the product's places, not tools it no longer has", () => {
    for (const q of ["comparar", "calendario", "generador", "aciertos"]) {
      expect(hrefs(commandsFor(q, ctx())).filter((h) => h.startsWith("page:"))).toEqual([]);
    }
    expect(hrefs(commandsFor("cartera", ctx()))[0]).toBe("page:portfolio");
    expect(hrefs(commandsFor("lienzo", ctx()))[0]).toBe("page:canvas");
  });

  it("finds pages and settings by their words", () => {
    // Typed in full, a page or setting comes before a guessed ticker; a real company found by that name wins.
    expect(hrefs(commandsFor("lista", ctx()))).toEqual(["page:watchlist", "/stock/LISTA"]);
    expect(hrefs(commandsFor("dark", ctx()))[0]).toBe("set:dark");
    expect(hrefs(commandsFor("dark", ctx({ results: [{ symbol: "DARK", name: "Dark Corp." }] })))[0]).toBe("/stock/DARK");
    expect(hrefs(commandsFor("metodología", ctx()))).toContain("page:methodology");
    expect(hrefs(commandsFor("oscuro", ctx()))).toContain("set:dark");
    expect(hrefs(commandsFor("english", ctx()))).toContain("set:en");
    expect(hrefs(commandsFor("tema", ctx()))).toEqual(expect.arrayContaining(["set:dark", "set:light"]));
  });
});
