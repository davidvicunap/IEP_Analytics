// Browser-level regression tests against a local production build in demo mode.
// Usage: node e2e/journeys.mjs [baseUrl]   (start: BETA_GATE=off DEMO_MODE=1 next start -p 3123)
// Network fixtures simulate races, failures, stale data and an expired beta session, so no
// provider quota is ever used.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const base = process.argv[2] ?? "http://localhost:3123";

const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`✗ ${name}\n    ${String(e?.message ?? e).split("\n")[0]}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const browser = await chromium.launch();
async function page({ width = 1280, height = 900, lang = "es", theme = "light", watchlist = [], touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, locale: lang === "es" ? "es-US" : "en-US" });
  await ctx.addCookies([{ name: "lang", value: lang, url: base }]);
  await ctx.addInitScript(
    ([theme, list]) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("iep.theme", theme);
        localStorage.setItem("iep.watchlist", JSON.stringify(list));
        sessionStorage.setItem("seeded", "1");
      }
    },
    [theme, watchlist],
  );
  await ctx.route(/tradingview\.com/, (r) => r.abort());
  await ctx.route(/\/api\/(sec|analysts|valuation)\//, (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not_configured" }) }));
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  return p;
}
async function axe(p) {
  await p.addScriptTag({ content: axeSource });
  const v = await p.evaluate(async () => (await window.axe.run()).violations.filter((x) => x.impact === "serious" || x.impact === "critical").map((x) => x.id));
  assert(v.length === 0, `axe serious/critical: ${v.join(", ")}`);
}
const json = (body, status = 200, headers = {}) => ({ status, contentType: "application/json", headers, body: JSON.stringify(body) });

// ---- Search ---------------------------------------------------------------------------------

await test("search: a slow answer for an older query never replaces the newer one", async () => {
  const p = await page();
  await p.route(/\/api\/search\?q=a$/, async (r) => {
    await new Promise((res) => setTimeout(res, 900));
    r.fulfill(json([{ symbol: "A", name: "Agilent Old Result" }]));
  });
  await p.route(/\/api\/search\?q=ab$/, (r) => r.fulfill(json([{ symbol: "ABBV", name: "AbbVie" }])));
  await p.goto(base + "/");
  const box = p.getByRole("combobox");
  await box.pressSequentially("a");
  await p.waitForTimeout(350); // first request is out
  await box.pressSequentially("b");
  await p.getByRole("option", { name: /AbbVie/ }).waitFor();
  await p.waitForTimeout(1000); // the old answer has arrived by now
  assert((await p.getByText("Agilent Old Result").count()) === 0, "stale result shown");
  await box.press("Enter");
  await p.waitForURL(/\/stock\/ABBV/);
  await p.context().close();
});

await test("search: Enter during loading waits for the answer instead of guessing", async () => {
  const p = await page();
  await p.route(/\/api\/search\?q=apple/, async (r) => {
    await new Promise((res) => setTimeout(res, 500));
    r.fulfill(json([{ symbol: "AAPL", name: "Apple Inc." }]));
  });
  await p.goto(base + "/");
  const box = p.getByRole("combobox");
  await box.fill("apple");
  await box.press("Enter");
  await p.waitForURL(/\/stock\/AAPL/, { timeout: 5000 });
  await p.context().close();
});

await test("search: failure is distinct from no results, and Enter retries", async () => {
  const p = await page();
  let fail = true;
  await p.route(/\/api\/search/, (r) => (fail ? r.fulfill(json({ error: "upstream" }, 503)) : r.fulfill(json([{ symbol: "KO", name: "Coca-Cola" }]))));
  await p.goto(base + "/");
  const box = p.getByRole("combobox");
  await box.fill("coca cola"); // not ticker-shaped, so Enter can't fall back to opening a ticker
  await p.locator(".shadow-xl").getByText("La búsqueda no está disponible en este momento.").waitFor();
  fail = false;
  await box.press("Enter");
  await p.getByRole("option", { name: /Coca-Cola/ }).waitFor();
  await p.unroute(/\/api\/search/);
  await p.route(/\/api\/search/, (r) => r.fulfill(json([])));
  await box.fill("qqqzzz");
  await p.locator(".shadow-xl").getByText("No encontramos «qqqzzz».").waitFor();
  await p.context().close();
});

await test("search: keyboard selection, Escape and focus", async () => {
  const p = await page();
  await p.route(/\/api\/search/, (r) => r.fulfill(json([{ symbol: "MSFT", name: "Microsoft" }, { symbol: "MSTR", name: "MicroStrategy" }])));
  await p.goto(base + "/stock/AAPL");
  await p.keyboard.press("/"); // shortcut focuses the header search
  const box = p.getByRole("combobox");
  assert(await box.evaluate((el) => el === document.activeElement), "/ didn't focus search");
  await box.pressSequentially("ms");
  await p.getByRole("option", { name: /MicroStrategy/ }).waitFor();
  await box.press("ArrowDown");
  await box.press("ArrowDown");
  assert((await box.getAttribute("aria-activedescendant"))?.endsWith("opt-1"), "active option not tracked");
  await box.press("Escape");
  assert((await p.getByRole("listbox").count()) === 0, "Escape didn't close the list");
  assert((await box.inputValue()) === "ms", "first Escape shouldn't clear");
  await box.press("Escape");
  assert((await box.inputValue()) === "", "second Escape should clear");
  await box.fill("ms");
  await p.getByRole("option", { name: /MicroStrategy/ }).waitFor();
  await box.press("ArrowDown");
  await box.press("ArrowDown");
  await box.press("Enter");
  await p.waitForURL(/\/stock\/MSTR/);
  await p.context().close();
});

await test("search: ignores the / shortcut inside editable content; Ctrl+K works", async () => {
  const p = await page();
  await p.goto(base + "/stock/AAPL");
  await p.evaluate(() => {
    const d = document.createElement("div");
    d.contentEditable = "true";
    d.id = "ed";
    d.textContent = "x";
    document.querySelector("main").prepend(d);
  });
  await p.click("#ed");
  await p.keyboard.press("/");
  assert(await p.evaluate(() => document.activeElement?.id === "ed"), "/ stole focus from contenteditable");
  await p.keyboard.press("Control+k");
  assert(await p.evaluate(() => document.activeElement?.getAttribute("role") === "combobox"), "Ctrl+K didn't focus search");
  await p.context().close();
});

await test("search: touch selection on a phone (expandable header search)", async () => {
  const p = await page({ width: 375, height: 740, touch: true });
  await p.route(/\/api\/search/, (r) => r.fulfill(json([{ symbol: "NVDA", name: "NVIDIA" }])));
  await p.goto(base + "/stock/AAPL");
  await p.getByRole("button", { name: "Buscar" }).tap();
  const box = p.getByRole("combobox");
  await box.fill("nvi");
  await p.getByRole("option", { name: /NVIDIA/ }).tap();
  await p.waitForURL(/\/stock\/NVDA/);
  await p.context().close();
});

// ---- Watchlist ------------------------------------------------------------------------------

const many = Array.from({ length: 45 }, (_, i) => `W${String.fromCharCode(65 + (i % 26))}${i >= 26 ? "Q" : ""}`);

await test("watchlist: 45 saved stocks are all priced, in pages of at most 30", async () => {
  const p = await page({ watchlist: many });
  const sizes = [];
  p.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/quotes") sizes.push(decodeURIComponent(u.searchParams.get("symbols")).split(",").length);
  });
  await p.goto(base + "/watchlist");
  await p.getByText("45 de 100").waitFor();
  await p.waitForFunction(() => document.querySelectorAll("main li a[href^='/stock/']").length === 45);
  await p.waitForTimeout(500);
  assert(sizes.every((n) => n <= 30) && sizes.reduce((a, b) => a + b, 0) === 45, `pages ${sizes}`);
  const priced = await p.locator("main li").filter({ hasText: "$" }).count();
  assert(priced === 45, `priced rows ${priced}`);
  await p.context().close();
});

await test("watchlist: home mini-list asks only for the 8 it shows", async () => {
  const p = await page({ watchlist: many });
  const asked = [];
  p.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/quotes") asked.push(...decodeURIComponent(u.searchParams.get("symbols")).split(","));
  });
  await p.goto(base + "/");
  await p.getByText("Ver las 45").waitFor();
  await p.waitForTimeout(800);
  assert(asked.length === 8, `asked for ${asked.length}`);
  await p.context().close();
});

await test("watchlist: partial failures, stale values and an expired beta session are labelled", async () => {
  const p = await page({ watchlist: ["AAPL", "MSFT", "KO"] });
  let mode = "partial";
  await p.route(/\/api\/quotes/, async (r) => {
    if (mode === "500") return r.fulfill(json({}, 500));
    if (mode === "401") return r.fulfill(json({ error: "beta_required" }, 401));
    const res = await r.fetch();
    const body = await res.json();
    body.quotes = body.quotes.filter((q) => q.symbol !== "KO");
    body.missing = [{ symbol: "KO", error: "rate_limited" }];
    r.fulfill(json(body));
  });
  await p.goto(base + "/watchlist");
  await p.getByText("No pudimos cargar 1 de 3 precios.", { exact: false }).waitFor();
  mode = "500";
  await p.getByRole("button", { name: "Actualizar" }).click();
  await p.getByText("No pudimos actualizar los precios.", { exact: false }).waitFor();
  assert((await p.locator("main").getByText("$").count()) > 0, "last good values gone");
  mode = "401";
  await p.getByRole("button", { name: "Actualizar" }).click();
  await p.getByText("Tu acceso a la beta caducó", { exact: false }).waitFor();
  await p.getByRole("link", { name: "Volver a entrar a la beta" }).waitFor();
  await p.context().close();
});

await test("watchlist: a list changed during fetching shows only the current list", async () => {
  const p = await page({ watchlist: ["AAPL", "MSFT", "KO"] });
  await p.route(/\/api\/quotes/, async (r) => {
    await new Promise((res) => setTimeout(res, 700));
    r.fulfill({ response: await r.fetch() });
  });
  await p.goto(base + "/watchlist");
  await p.getByRole("button", { name: "Quitar MSFT de la lista" }).waitFor({ timeout: 8000 });
  await p.getByRole("button", { name: "Quitar MSFT de la lista" }).click();
  await p.waitForTimeout(1600);
  const rows = await p.locator("main ul li a[href^='/stock/']").allInnerTexts();
  assert(rows.length === 2 && !rows.join(" ").includes("MSFT"), `rows: ${rows.join(" | ")}`);
  await p.context().close();
});

await test("watchlist: remove, undo puts it back in place; saving from a stock page confirms it", async () => {
  const p = await page({ watchlist: ["AAPL", "MSFT", "KO"] });
  await p.goto(base + "/watchlist");
  await p.getByRole("button", { name: "Quitar MSFT de la lista" }).click();
  await p.getByRole("button", { name: "Deshacer" }).click();
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("iep.watchlist")));
  assert(JSON.stringify(saved) === JSON.stringify(["AAPL", "MSFT", "KO"]), `after undo: ${saved}`);
  await p.goto(base + "/stock/NVDA");
  await p.getByRole("button", { name: "Seguir", exact: true }).click();
  await p.getByText("NVDA se guardó en tu lista.").waitFor();
  assert((await p.getByRole("button", { name: "Siguiendo" }).getAttribute("aria-pressed")) === "true", "not pressed");
  await p.context().close();
});

await test("watchlist: corrupted storage is cleaned up, not fatal", async () => {
  const p = await page({ watchlist: ["aapl", "AAPL", 7, "<b>", "ko"] });
  await p.goto(base + "/watchlist");
  await p.getByText("2 de 100").waitFor();
  await p.context().close();
});

// ---- Stock page -------------------------------------------------------------------------------

await test("stock: tabs are history entries; keyboard Home/End; chart settings in the URL", async () => {
  const p = await page();
  await p.goto(base + "/stock/AAPL");
  await p.getByRole("tab", { name: "Gráfico", exact: true }).click();
  await p.waitForURL(/tab=chart/);
  await p.goBack();
  await p.waitForURL((u) => !u.search.includes("tab="));
  assert((await p.getByRole("tab", { name: "Resumen" }).getAttribute("aria-selected")) === "true", "Back didn't return to overview");
  await p.goForward();
  await p.waitForURL(/tab=chart/);
  await p.getByRole("tab", { name: "Gráfico", exact: true }).focus();
  await p.keyboard.press("End");
  await p.waitForURL(/tab=news/);
  assert(await p.evaluate(() => document.activeElement?.id === "tab-news"), "End didn't move focus");
  await p.keyboard.press("Home");
  await p.waitForURL((u) => !u.search.includes("tab="));
  await p.waitForFunction(() => document.getElementById("tab-overview")?.getAttribute("aria-selected") === "true");
  const overview = p.locator("#panel-overview");
  await overview.getByRole("button", { name: "6M" }).click();
  await p.waitForURL(/range=6M/);
  await overview.getByRole("button", { name: /RSI/ }).click();
  await p.waitForURL(/ind=sma%2Crsi%2Cvolume|ind=sma,rsi,volume/);
  await p.reload();
  assert((await p.locator("#panel-overview").getByRole("button", { name: "6M" }).getAttribute("aria-pressed")) === "true", "range lost on reload");
  await p.context().close();
});

await test("stock: chart keeps one canvas set through control and theme changes (no leaks)", async () => {
  const p = await page();
  await p.goto(base + "/stock/AAPL");
  const fig = p.locator("#panel-overview figure");
  await fig.locator("canvas").first().waitFor();
  const count = () => p.locator("#panel-overview canvas").count();
  const panesOf = async () => (await p.locator("#panel-overview table tr td canvas, #panel-overview canvas").count());
  const before = await count();
  const ov = p.locator("#panel-overview");
  await p.waitForTimeout(300);
  for (let i = 0; i < 3; i++) {
    await ov.getByRole("button", { name: "Línea" }).click();
    await ov.getByRole("button", { name: "Velas" }).click();
    await ov.getByRole("button", { name: /Bandas de Bollinger/ }).click();
    await ov.getByRole("button", { name: /Bandas de Bollinger/ }).click();
    await p.getByRole("button", { name: /Tema/ }).click();
  }
  await p.waitForTimeout(500);
  const after = await count();
  assert(after === before, `canvases ${before} → ${after}`);
  await ov.getByRole("button", { name: /MACD/ }).click();
  await p.waitForFunction((n) => document.querySelectorAll("#panel-overview canvas").length > n, before);
  const withPane = await panesOf();
  await ov.getByRole("button", { name: /MACD/ }).click();
  await p.waitForFunction((n) => document.querySelectorAll("#panel-overview canvas").length === n, before);
  assert(withPane > before, `pane add/remove ${before} → ${withPane} → ${await count()}`);
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("stock: the chart's numbers are available as a table and as a text summary", async () => {
  const p = await page();
  await p.goto(base + "/stock/AAPL");
  const cap = await p.locator("#panel-overview figcaption").innerText();
  assert(/Gráfico de precios/.test(cap), "no summary");
  await p.locator("#panel-overview").getByText("Ver los datos del gráfico").click();
  await p.locator("#panel-overview [role=region] tbody tr").first().waitFor();
  const rows = await p.locator("#panel-overview [role=region] tbody tr").count();
  assert(rows > 200, `table rows ${rows}`);
  await p.context().close();
});

await test("stock: unknown ticker is a real 404", async () => {
  const p = await page();
  const res = await p.goto(base + "/stock/1NOPE");
  assert(res.status() === 404, `status ${res.status()}`);
  await p.context().close();
});

await test("stock: negative and missing values in the 10-year bars are honest", async () => {
  const p = await page();
  const years = ["FY2022", "FY2023", "FY2024", "FY2025"].map((label, i) => ({ label, end: `${2022 + i}-12-31` }));
  await p.route(/\/api\/sec\/quality\//, (r) =>
    r.fulfill(
      json({
        ok: true,
        fetchedAt: "2026-11-07T00:00:00Z",
        data: {
          symbol: "AAPL", cik: 1, name: "Test", businessType: "general", years, checks: [],
          summary: { passed: 0, failed: 0, na: 0, level: "na" }, growth: [],
          trends: [{ key: "netIncome", values: [1.2e9, -4e8, null, 9e8] }],
          splitAdjusted: false, lastFiscal: null,
        },
      }),
    ),
  );
  await p.goto(base + "/stock/AAPL?tab=fundamentals");
  const card = p.locator("article", { hasText: "Beneficio neto" });
  await card.waitFor();
  assert((await card.locator(".bg-down").count()) === 1, "one bar below zero");
  assert((await card.locator(".bg-series-1").count()) === 2, "two bars above zero");
  await card.getByText("Ver los datos").click();
  const cells = await card.locator("tbody td").allInnerTexts();
  assert(cells.some((c) => c.startsWith("−$")) && cells.includes("—"), `cells ${cells.join(",")}`);
  await p.context().close();
});

// ---- Data tabs (the shared resource state machine, lib/resource.ts) -----------------------------

await test("data tabs: an expired beta session asks to sign in again and comes back to the same tab", async () => {
  const p = await page();
  // The gate answers 401 without our envelope; before, most tabs showed an empty message.
  await p.route(/\/api\/(sec\/(quality|ratios)|analysts)\//, (r) => r.fulfill(json({ error: "beta_required" }, 401)));
  await p.goto(base + "/stock/AAPL?tab=fundamentals");
  await p.getByText("Tu acceso a la beta caducó. Vuelve a entrar para ver esta sección.").first().waitFor();
  const link = p.getByRole("link", { name: "Volver a entrar a la beta" }).first();
  const href = await link.getAttribute("href");
  assert(href === "/beta?next=%2Fstock%2FAAPL%3Ftab%3Dfundamentals", `href ${href}`);
  assert(!(await p.getByText("rechazó nuestra credencial").count()), "blamed the data provider");
  await axe(p);
  await p.context().close();
});

await test("data tabs: a failed read offers a retry that asks again in place", async () => {
  const p = await page();
  let calls = 0;
  await p.route(/\/api\/sec\/insiders\//, (r) =>
    ++calls === 1 ? r.fulfill({ status: 502, contentType: "text/html", body: "<html>bad gateway</html>" }) : r.fulfill(json({ ok: false, error: "not_configured" }, 503)),
  );
  await p.goto(base + "/stock/AAPL?tab=insiders");
  await p.getByText("El proveedor de datos no responde. Inténtalo de nuevo más tarde.").waitFor();
  await p.getByRole("button", { name: "Reintentar" }).click();
  await p.getByText("La fuente de datos no está configurada.").waitFor();
  assert(calls === 2, `calls ${calls}`);
  assert((await p.getByRole("button", { name: "Reintentar" }).count()) === 0, "no retry for a permanent issue");
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

// ---- Stocks FMP can't price (demo: DEMO_PRICE_FALLBACK in npm run start:demo) ------------------

await test("every stock opens: no price, last close or stored price, each said plainly", async () => {
  const p = await page({ lang: "en" });
  // No price at all: the page still opens, says why and points to the live chart.
  await p.goto(base + "/stock/HIMS");
  await p.getByRole("heading", { level: 1 }).waitFor();
  const none = p.locator("[data-price-basis=none]");
  await none.getByText("Price unavailable").waitFor();
  assert((await none.innerText()).includes("isn't included in the current data plan"), await none.innerText());
  await none.getByRole("button", { name: "See the live chart" }).click();
  await p.waitForURL(/tab=chart/);
  assert((await p.getByRole("tab", { name: "Filings" }).count()) === 1, "tabs missing");
  await axe(p);
  // Last daily close and stored price: the price is shown, labelled with what it is.
  await p.goto(base + "/stock/SMCI");
  await p.locator("[data-price-basis=close]").getByText(/^Closing price of/).waitFor();
  await p.goto(base + "/stock/AMD");
  const stored = p.locator("[data-price-basis=stored]");
  await stored.getByText(/^Last price we stored/).waitFor();
  assert((await stored.innerText()).includes("daily request limit"), await stored.innerText());
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

// ---- Research notebook (demo: in-memory store, owner "local") ---------------------------------

await test("research notebook: write a thesis and fair value, add a note, find it everywhere", async () => {
  const p = await page({ lang: "en" });
  await p.goto(base + "/stock/KO?tab=research");
  const thesis = p.getByLabel("Thesis");
  await thesis.waitFor();
  await thesis.fill("Pricing power and a global distribution moat.");
  await p.getByLabel("Bull case").fill("Brand\nDividend growth");
  await p.getByLabel("Fair value").fill("75");
  await p.getByText("Unsaved changes").waitFor();
  await p.getByRole("button", { name: "Save" }).click();
  await p.getByText(/^Saved ·/).waitFor();
  // The header shows the fair value against the price; the history records it.
  await p.getByTestId("fair-value-line").getByText("Your fair value: $75.00").waitFor();
  await p.getByRole("region", { name: "Your fair value over time" }).getByText("By hand").waitFor();
  // A dated note, then a reload: everything is still there.
  await p.getByLabel("New note").fill("Q3: volumes up in Latin America");
  await p.getByRole("button", { name: "Add note" }).click();
  await p.getByText("Q3: volumes up in Latin America").waitFor();
  await p.reload();
  await p.getByLabel("Thesis").waitFor();
  assert((await p.getByLabel("Thesis").inputValue()).startsWith("Pricing power"), "thesis not kept");
  await axe(p);
  // The overview card and the list page show it too.
  await p.getByRole("tab", { name: "Overview" }).click();
  await p.locator("#research-card").getByText("Pricing power and a global distribution moat.").waitFor();
  await p.goto(base + "/research");
  const row = p.getByRole("link", { name: /KO/ });
  await row.getByText("$75.00").waitFor();
  await axe(p);
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("research notebook: an edit from an outdated tab is refused, not silently overwritten", async () => {
  const a = await page({ lang: "en" });
  const b = await a.context().newPage();
  for (const p of [a, b]) {
    await p.goto(base + "/stock/PEP?tab=research");
    await p.getByLabel("Thesis").waitFor();
  }
  await b.getByLabel("Thesis").fill("Written in tab B");
  await b.getByRole("button", { name: "Save" }).click();
  await b.getByText(/^Saved ·/).waitFor();
  await a.getByLabel("Thesis").fill("Written in tab A");
  await a.getByRole("button", { name: "Save" }).click();
  await a.getByText(/changed on another device/).waitFor();
  assert((await a.getByLabel("Thesis").inputValue()) === "Written in tab A", "draft lost");
  await a.getByRole("button", { name: "Reload" }).waitFor();
  await a.context().close();
});

// ---- Chart generator --------------------------------------------------------------------------

// Small synthetic series (test data only): two companies with different fiscal years.
function seriesFixture(symbol, scale) {
  const keys = ["FY2021", "FY2022", "FY2023", "FY2024", "FY2025"];
  const revenue = [100, 110, 125, 120, 140].map((v) => v * scale * 1e9);
  const netIncome = [10, 12, -3, 14, 18].map((v) => v * scale * 1e9);
  const values = { revenue, netIncome, netMargin: netIncome.map((n, i) => n / revenue[i]) };
  const q = { keys: [], ends: [], values: {} };
  return { ok: true, fetchedAt: "2026-11-07T12:00:00Z", data: { symbol, name: `${symbol} Inc.`, annual: { keys, ends: keys.map((k) => `${k.slice(2)}-12-31`), values }, quarterly: q } };
}
async function chartsPage(opts) {
  const p = await page(opts);
  await p.route(/\/api\/sec\/series\/([A-Z.]+)/, (r) => {
    const s = r.request().url().split("/").pop();
    if (s === "AAA") return r.fulfill(json(seriesFixture("AAA", 1)));
    if (s === "BBB") return r.fulfill(json(seriesFixture("BBB", 2)));
    return r.fulfill(json({ ok: false, error: "not_found" }, 404));
  });
  return p;
}

await test("charts: URL state, legend toggle, keyboard readout and CSV", async () => {
  const p = await chartsPage();
  await p.goto(base + "/charts?s=AAA,BBB&m=revenue&f=annual&k=bar&r=5");
  const chart = p.locator("svg[aria-roledescription=chart]");
  await chart.waitFor();
  assert((await chart.locator("path[fill]").count()) === 10, "2 companies × 5 years of bars");
  // Legend hides and shows a series, without repainting the other.
  const legendA = p.getByRole("button", { name: "AAA", exact: true });
  await legendA.click();
  assert((await legendA.getAttribute("aria-pressed")) === "false", "legend toggle");
  assert((await chart.locator("path[fill]").count()) === 5, "hidden series removed");
  await legendA.click();
  // Keyboard: focus the chart and step through periods.
  await chart.focus();
  await p.keyboard.press("Home");
  const tip = p.locator("[role=status]", { hasText: "FY2021" });
  await tip.waitFor();
  assert((await tip.innerText()).includes("$100B"), `readout ${await tip.innerText()}`);
  // Options update the URL (shareable), growth uses the period before.
  await p.getByRole("group", { name: "Mostrar" }).getByRole("button", { name: "Crecimiento" }).click();
  await p.waitForURL(/t=growth/);
  await p.keyboard.press("Tab");
  await chart.focus();
  await p.keyboard.press("End");
  await p.locator("[role=status]", { hasText: "+16.7%" }).or(p.locator("[role=status]", { hasText: "16.7%" })).first().waitFor();
  // CSV export has a header and one row per period.
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: /CSV/ }).click()]);
  const csv = readFileSync(await dl.path(), "utf8").trim().split("\n");
  assert(csv[0] === "Periodo,AAA (%),BBB (%)", `csv header ${csv[0]}`);
  assert(csv.length === 6, `csv rows ${csv.length}`);
  await axe(p);
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("charts: a company without filings is reported; units can't be mixed without a transform", async () => {
  const p = await chartsPage({ lang: "en" });
  await p.goto(base + "/charts?s=AAA,ZZZ&m=revenue,netMargin&f=annual&k=line");
  await p.locator("svg[aria-roledescription=chart]").waitFor();
  await p.getByText(/ZZZ.*:/).first().waitFor();
  assert(!p.url().includes("netMargin") || (await p.getByRole("button", { name: /Revenue/ }).first().innerText()) === "Revenue", "mixed units dropped");
  await p.getByRole("button", { name: /^Revenue/ }).first().click();
  const margin = p.getByRole("checkbox", { name: /Net margin/ });
  assert(await margin.isDisabled(), "different unit is disabled while showing values");
  await p.keyboard.press("Escape");
  await p.getByRole("group", { name: "Show" }).getByRole("button", { name: "Index 100" }).click();
  await p.getByRole("button", { name: /^Revenue/ }).first().click();
  await p.getByRole("checkbox", { name: /Net margin/ }).check();
  await p.waitForURL(/m=revenue,netMargin/);
  await p.context().close();
});

await test("charts: phone layout uses compact selects and never scrolls sideways", async () => {
  const p = await chartsPage({ width: 360, height: 780, touch: true });
  await p.goto(base + "/charts?s=AAA,BBB&m=revenue&f=annual");
  await p.locator("svg[aria-roledescription=chart]").waitFor();
  await p.getByRole("combobox", { name: "Periodicidad" }).selectOption("quarterly");
  await p.waitForURL(/f=quarterly/);
  assert((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, "horizontal overflow");
  await axe(p);
  await p.context().close();
});

await test("charts: monthly prices in demo mode say they're unavailable instead of inventing them", async () => {
  const p = await chartsPage();
  await p.goto(base + "/charts?s=AAA&m=pe&f=monthly");
  await p.getByText("El historial de precios no está disponible en este momento.").waitFor();
  assert((await p.locator("svg[aria-roledescription=chart]").count()) === 0, "no chart without data");
  await p.context().close();
});

// ---- Journeys in both languages and themes ------------------------------------------------

for (const [lang, theme] of [["es", "light"], ["en", "dark"]]) {
  await test(`journey (${lang}, ${theme}): search → stock → save → watchlist, accessible on the way`, async () => {
    const p = await page({ lang, theme, width: 390, height: 844, touch: true });
    await p.goto(base + "/");
    await axe(p);
    const box = p.getByRole("combobox");
    await box.fill("apple");
    await p.getByRole("option").first().waitFor();
    await box.press("Enter");
    await p.waitForURL(/\/stock\//);
    await p.getByRole("heading", { level: 1 }).waitFor();
    await p.getByText(lang === "es" ? "En pocas palabras" : "In a nutshell").waitFor();
    await axe(p);
    const symbol = p.url().split("/stock/")[1];
    await p.getByRole("button", { name: lang === "es" ? "Seguir" : "Follow", exact: true }).tap();
    await p.getByRole("link", { name: lang === "es" ? "Mi lista" : "Watchlist" }).last().tap();
    await p.waitForURL(/\/watchlist/);
    await p.locator(`a[href="/stock/${symbol}"]`).waitFor();
    await axe(p);
    assert(p.errors.length === 0, p.errors.join(" | "));
    await p.context().close();
  });
}

await test("language switch loads the other dictionary and keeps the page working", async () => {
  const p = await page();
  await p.goto(base + "/stock/AAPL");
  await p.getByText("En pocas palabras").waitFor();
  await p.getByRole("button", { name: /^ES,/ }).click();
  await p.getByText("In a nutshell").waitFor();
  assert((await p.evaluate(() => document.documentElement.lang)) === "en", "html lang not updated");
  await p.reload();
  await p.getByText("In a nutshell").waitFor(); // remembered (cookie)
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("slow network: home shows search and skeletons before quotes arrive", async () => {
  const p = await page({ width: 390, height: 844, touch: true });
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 20_000 });
  await p.goto(base + "/", { waitUntil: "commit" });
  await p.getByRole("heading", { level: 1 }).waitFor();
  await p.getByRole("combobox").waitFor();
  await p.getByText("$").first().waitFor({ timeout: 30_000 });
  await p.context().close();
});

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
