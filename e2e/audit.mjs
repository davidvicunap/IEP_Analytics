// Responsive, theme, language and accessibility audit of a local production build.
// Usage: node e2e/audit.mjs <baseUrl> <outDir> [--shots] [--quick]
// For every page × width × theme × language it checks:
//   - horizontal overflow: elements that stick out of the viewport and aren't inside their own
//     scroll container (catches defects that `overflow-x: hidden` on <body> would conceal);
//   - axe-core (WCAG 2.2 AA tags) violations, reported by impact;
//   - touch targets under 44×44 CSS px for primary controls (buttons, links, inputs) on mobile.
// With --shots it also saves screenshots for the main combinations.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const axeSource = readFileSync(process.env.AXE_PATH ?? require.resolve("axe-core/axe.min.js"), "utf8");

const base = process.argv[2] ?? "http://localhost:3123";
const outDir = process.argv[3] ?? "audit";
const shots = process.argv.includes("--shots");
const quick = process.argv.includes("--quick");
mkdirSync(outDir, { recursive: true });

const WATCHLIST = ["AAPL", "MSFT", "NVDA", "BRK.B", "GOOGL", "JPM"];
const PAGES = [
  { name: "home", path: "/" },
  { name: "stock", path: "/stock/AAPL" },
  { name: "chart", path: "/stock/AAPL", tab: "chart" },
  { name: "fundamentals", path: "/stock/AAPL", tab: "fundamentals" },
  { name: "news", path: "/stock/AAPL", tab: "news" },
  { name: "charts", path: "/charts" },
  { name: "research", path: "/research" },
  { name: "screener", path: "/screener" },
  { name: "notebook", path: "/stock/AAPL", tab: "research" },
  { name: "watchlist", path: "/watchlist" },
  { name: "watchlist-empty", path: "/watchlist", empty: true },
  { name: "beta", path: "/beta" },
  { name: "notfound", path: "/stock/1NOPE" },
];
const WIDTHS = quick
  ? [{ w: 390, h: 844, name: "390" }, { w: 1440, h: 900, name: "1440" }]
  : [
      { w: 320, h: 640, name: "320" },
      { w: 390, h: 844, name: "390" },
      { w: 768, h: 1024, name: "768" },
      { w: 1024, h: 768, name: "1024" },
      { w: 1440, h: 900, name: "1440" },
      { w: 844, h: 390, name: "landscape" },
      { w: 640, h: 450, dpr: 2, name: "zoom200" }, // 1280×900 at 200 % zoom
    ];
const COMBOS = quick ? [["es", "light"], ["en", "dark"]] : [["es", "light"], ["es", "dark"], ["en", "light"], ["en", "dark"]];

const TAB_LABEL = { es: { chart: "Gráfico", fundamentals: "Fundamentales", news: "Noticias", research: "Mi análisis" }, en: { chart: "Chart", fundamentals: "Fundamentals", news: "News", research: "My research" } };

async function open(browser, page, width, lang, theme) {
  const ctx = await browser.newContext({
    viewport: { width: width.w, height: width.h },
    deviceScaleFactor: width.dpr ?? 1,
    hasTouch: width.w < 900,
    isMobile: width.w < 900,
    reducedMotion: "reduce",
  });
  await ctx.addCookies([{ name: "lang", value: lang, url: base }]);
  await ctx.addInitScript(
    ([theme, list]) => {
      try {
        localStorage.setItem("iep.theme", theme);
        localStorage.setItem("iep.watchlist", JSON.stringify(list));
      } catch {}
    },
    [theme, page.empty ? [] : WATCHLIST],
  );
  // SEC/FMP-backed client sections have no data locally: answer them like an unconfigured server.
  await ctx.route(/\/api\/(sec|analysts|valuation)\//, (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not_configured" }) }));
  await ctx.route(/tradingview\.com|s3\.tradingview\.com/, (r) => r.abort());
  const tab = await ctx.newPage();
  await tab.goto(base + page.path, { waitUntil: "load", timeout: 60_000 });
  if (page.tab) {
    await tab.getByRole("tab", { name: TAB_LABEL[lang][page.tab], exact: true }).click();
  }
  await tab.waitForTimeout(1200);
  return { ctx, tab };
}

function overflowProbe() {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  const scrolls = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
    }
    return false;
  };
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 || r.left < -1) {
      if (scrolls(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" && el.closest("[aria-hidden=true]")) continue;
      bad.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${String(el.className).slice(0, 40)} (${Math.round(r.left)}–${Math.round(r.right)} of ${vw})`);
    }
  }
  return { scrollX: document.documentElement.scrollWidth > vw + 1, elements: bad.slice(0, 5), count: bad.length };
}

function targetProbe() {
  const small = [];
  for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, summary, [role=tab]")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden") continue;
    // Inline links inside running text are exempt (WCAG 2.5.8 inline exception).
    if (el.tagName === "A" && cs.display === "inline") continue;
    // Disclosure summaries ("What is this?") are secondary: 24×24 minimum (WCAG 2.5.8).
    const min = el.tagName === "SUMMARY" ? 24 : 43.5;
    if (r.height < min || r.width < 24) small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  return small;
}

const browser = await chromium.launch();
const report = [];
for (const page of PAGES) {
  for (const width of WIDTHS) {
    for (const [lang, theme] of COMBOS) {
      const { ctx, tab } = await open(browser, page, width, lang, theme);
      const overflow = await tab.evaluate(overflowProbe);
      let axe = null;
      let small = null;
      if (["390", "1440"].includes(width.name)) {
        await tab.addScriptTag({ content: axeSource });
        const res = await tab.evaluate(async () =>
          (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } })).violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            n: v.nodes.length,
            target: String(v.nodes[0]?.target ?? ""),
          })),
        );
        axe = res;
        if (width.name === "390") small = await tab.evaluate(targetProbe);
      }
      const shotName = `${page.name}-${width.name}-${lang}-${theme}.png`;
      if (shots && ["390", "1440"].includes(width.name) && (lang === "es" && theme === "light" || page.name === "home" || page.name === "stock")) {
        await tab.screenshot({ path: path.join(outDir, shotName), fullPage: true });
      }
      const row = { page: page.name, width: width.name, lang, theme, overflow, axe, small };
      report.push(row);
      const serious = axe ? axe.filter((v) => v.impact === "serious" || v.impact === "critical") : [];
      console.log(
        `${page.name.padEnd(16)} ${width.name.padEnd(9)} ${lang}-${theme.padEnd(5)} overflow ${overflow.count ? "✗ " + overflow.count : "✓"}` +
          (axe ? ` axe ${axe.length} (${serious.length} serious/critical${serious.length ? ": " + serious.map((v) => v.id).join(",") : ""})` : "") +
          (small ? ` small-targets ${small.length}` : ""),
      );
      await ctx.close();
    }
  }
}
await browser.close();
writeFileSync(path.join(outDir, "audit.json"), JSON.stringify(report, null, 2));
const sum = {
  overflowFailures: report.filter((r) => r.overflow.count).length,
  axeSeriousCritical: report.reduce((n, r) => n + (r.axe ?? []).filter((v) => v.impact === "serious" || v.impact === "critical").length, 0),
  axeTotal: report.reduce((n, r) => n + (r.axe ?? []).length, 0),
  smallTargets: report.reduce((n, r) => n + (r.small ?? []).length, 0),
  checks: report.length,
};
console.log("SUMMARY", JSON.stringify(sum));
writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(sum, null, 2));
