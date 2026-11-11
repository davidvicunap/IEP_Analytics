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
  await p.waitForFunction(() => document.querySelectorAll("main tbody th a[href^='/stock/']").length === 45);
  await p.waitForTimeout(500);
  assert(sizes.every((n) => n <= 30) && sizes.reduce((a, b) => a + b, 0) === 45, `pages ${sizes}`);
  const priced = await p.locator("main tbody tr").filter({ hasText: "$" }).count();
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
  const rows = await p.locator("main tbody th a[href^='/stock/']").allInnerTexts();
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

const snapshot = (symbol, o = {}) => ({
  symbol,
  cik: 1,
  quality: { ok: true, data: { passed: o.passed ?? 5, failed: o.failed ?? 4, na: 0, level: o.level ?? "mixed", fiscal: "FY2026" } },
  filings: {
    ok: true,
    data: {
      report: { accn: "0000000001-26-000001", form: "10-K", filed: "2026-02-01", reportDate: "2025-12-31", primaryDocument: "a.htm", items: [] },
      latest: { accn: "0000000001-26-000002", form: "8-K", filed: o.filed ?? "2026-10-01", reportDate: null, primaryDocument: "b.htm", items: ["2.02"] },
    },
  },
  insiders: o.insiders ?? { ok: true, data: { from: "", to: "", bought: o.bought ?? 0, sold: o.sold ?? 0, buyers: 0, sellers: 0, pending: o.pending ?? 0, checkedAt: "2026-11-01T00:00:00Z" } },
});

await test("watchlist dashboard: SEC columns load per row, sort with gaps last, and a failed row says why and retries", async () => {
  const p = await page({ watchlist: ["AAPL", "MSFT", "KO"] });
  let koFails = true;
  await p.route(/\/api\/sec\/snapshot\//, (r) => {
    const s = decodeURIComponent(r.request().url().split("/snapshot/")[1]);
    if (s === "KO" && koFails) return r.fulfill(json({ ok: false, error: "rate_limited" }, 502));
    const o = s === "AAPL" ? { passed: 8, failed: 1, level: "high", sold: 2.4e7 } : { passed: 3, failed: 6, level: "low", bought: 1.2e6, pending: 2 };
    return r.fulfill(json({ ok: true, data: snapshot(s, o), fetchedAt: new Date().toISOString() }));
  });
  await p.goto(base + "/watchlist");
  await p.getByText("8/9").waitFor();
  await p.getByText("Compras $1.2M").waitFor();
  await p.getByText("parcial").waitFor(); // insider filings still to read
  await p.getByText("No pudimos cargar los datos de la SEC de 1 de 3 acciones", { exact: false }).waitFor();
  const order = async () => (await p.locator("main tbody th a[href^='/stock/']").allInnerTexts()).map((t) => t.split("\n")[0]);
  await p.getByRole("button", { name: "Ordenar por Calidad" }).click();
  assert((await order()).join() === "AAPL,MSFT,KO", `quality desc: ${await order()}`);
  await p.getByRole("button", { name: "Ordenar por Calidad" }).click();
  assert((await order()).join() === "MSFT,AAPL,KO", `quality asc keeps the gap last: ${await order()}`);
  assert((await p.locator("th[aria-sort='ascending']").count()) === 1, "aria-sort not set");
  await p.getByRole("button", { name: "Volver al orden guardado" }).click();
  assert((await order()).join() === "AAPL,MSFT,KO", "saved order not restored");
  koFails = false;
  await p.getByRole("button", { name: "Reintentar" }).click();
  await p.waitForFunction(() => document.querySelectorAll("main tbody tr").length === 3 && !document.body.innerText.includes("No pudimos cargar los datos de la SEC"));
  await axe(p);
  await p.context().close();
});

await test("watchlist dashboard: tags filter the list and columns can be hidden, both remembered", async () => {
  const p = await page({ watchlist: ["AAPL", "MSFT", "KO"] });
  await p.goto(base + "/watchlist");
  await p.getByRole("button", { name: "Editar etiquetas de MSFT" }).click();
  await p.getByLabel("Nueva etiqueta").fill("  Dividendos ");
  await p.getByRole("button", { name: "Añadir", exact: true }).click();
  await p.getByRole("button", { name: "Listo" }).click();
  await p.getByRole("button", { name: "Editar etiquetas de KO" }).click();
  await p.getByRole("button", { name: "Dividendos", exact: true }).click(); // the existing tag, one click
  await p.getByRole("button", { name: "Listo" }).click();
  await p.getByRole("group", { name: "Filtrar por etiqueta" }).getByRole("button", { name: /Dividendos/ }).click();
  await p.waitForFunction(() => document.querySelectorAll("main tbody th a[href^='/stock/']").length === 2);
  await p.locator("summary", { hasText: "Columnas" }).click();
  await p.getByRole("checkbox", { name: /Directivos/ }).uncheck();
  await p.reload();
  assert((await p.getByRole("button", { name: "Ordenar por Directivos (12 m)" }).count()) === 0, "hidden column came back");
  const tags = await p.evaluate(() => JSON.parse(localStorage.getItem("iep.watchtags")));
  assert(JSON.stringify(tags) === JSON.stringify({ MSFT: ["Dividendos"], KO: ["Dividendos"] }), `tags ${JSON.stringify(tags)}`);
  await p.context().close();
});

await test("watchlist dashboard: phone keeps the page from scrolling sideways", async () => {
  const p = await page({ watchlist: ["AAPL", "MSFT", "KO"], width: 320, height: 640, touch: true });
  await p.goto(base + "/watchlist");
  await p.locator("main tbody tr").first().waitFor();
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(over <= 0, `page overflows by ${over}px`);
  await p.context().close();
});

// ---- Filing reader ------------------------------------------------------------------------------

const report = (section) => {
  const reports = [
    { accn: "0000320193-26-000026", form: "10-K", filed: "2026-11-03", reportDate: "2026-09-26", primaryDocument: "a.htm" },
    { accn: "0000320193-25-000079", form: "10-K", filed: "2025-10-31", reportDate: "2025-09-27", primaryDocument: "b.htm" },
  ];
  const para = (t) => ({ k: "p", t });
  const content =
    section === "risks"
      ? {
          key: "risks",
          chars: 900,
          truncated: false,
          blocks: [
            para("The following summarizes factors that could have a material adverse effect."),
            { k: "p", t: "Global economic conditions could hurt the Company’s results.", e: true },
            para("Body of an unchanged risk."),
            { k: "p", t: "Issues related to artificial intelligence may result in reputational harm.", e: true, mark: "new" },
            para("Body of a new risk."),
            { k: "p", t: "The Company depends on component suppliers in Asia.", e: true, mark: "changed" },
            para("Body of a reworded risk."),
          ],
        }
      : section === "mdna"
        ? null
        : { key: section, chars: 300, truncated: true, blocks: [para("Apple designs smartphones."), { k: "table", rows: [["2026", "2025"], ["Net sales", "$416,161", "$391,035"]] }] };
  return {
    symbol: "AAPL",
    cik: 320193,
    name: "Apple Inc.",
    filing: reports[0],
    reports,
    section,
    content,
    risks: section === "risks" ? { prior: reports[1], diff: { added: [content.blocks[3].t], changed: [{ now: content.blocks[5].t, before: "The Company depends on suppliers." }], removed: ["Pandemic risks."], same: 1, total: 3, totalBefore: 3 } } : null,
    risksNote: null,
  };
};

await test("filing reader: sections in the URL, risk changes flagged, only-changed filter, honest gaps", async () => {
  const p = await page({ width: 390, height: 844, touch: true });
  const asked = [];
  await p.route(/\/api\/sec\/report\//, (r) => {
    const u = new URL(r.request().url());
    asked.push(`${u.searchParams.get("s")}|${u.searchParams.get("accn") ?? ""}`);
    r.fulfill(json({ ok: true, data: report(u.searchParams.get("s")), fetchedAt: new Date().toISOString() }));
  });
  await p.goto(base + "/stock/AAPL/report");
  await p.getByRole("heading", { level: 1, name: "Apple Inc.: informe anual 10-K" }).waitFor();
  await p.getByText("Apple designs smartphones.").waitFor();
  await p.getByText("Esta sección es muy larga", { exact: false }).waitFor();
  await p.getByRole("button", { name: "Riesgos", exact: true }).tap();
  await p.waitForURL(/s=risks/);
  await p.getByText("1 nuevos").waitFor();
  await p.locator("h3", { hasText: "artificial intelligence" }).getByText("Nuevo").waitFor();
  await p.getByLabel("Mostrar solo riesgos nuevos y reformulados").check();
  assert((await p.getByText("Body of an unchanged risk.").count()) === 0, "unchanged risk still shown");
  await p.getByText("Body of a reworded risk.").waitFor();
  await axe(p);
  await p.getByRole("button", { name: "Análisis de la dirección" }).tap();
  await p.getByText("No encontramos esta sección en este informe", { exact: false }).waitFor();
  await p.getByLabel("Informe", { exact: true }).selectOption("0000320193-25-000079");
  await p.waitForURL(/accn=0000320193-25-000079/);
  await p.goBack();
  await p.waitForURL((u) => !u.search.includes("accn"));
  assert(asked.includes("mdna|0000320193-25-000079"), `requests: ${asked}`);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(over <= 0, `page overflows by ${over}px`);
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("filing reader: a failed read says why and retries in place", async () => {
  const p = await page();
  let fail = true;
  await p.route(/\/api\/sec\/report\//, (r) => (fail ? r.fulfill(json({ ok: false, error: "upstream" }, 502)) : r.fulfill(json({ ok: true, data: report("business"), fetchedAt: new Date().toISOString() }))));
  await p.goto(base + "/stock/AAPL/report");
  await p.getByRole("button", { name: "Reintentar" }).waitFor();
  fail = false;
  await p.getByRole("button", { name: "Reintentar" }).click();
  await p.getByText("Apple designs smartphones.").waitFor();
  await p.context().close();
});

await test("chart: TradingView keeps its full height after its script resizes the container", async () => {
  const p = await page();
  // Stand-in for TradingView's script: like the real one, it rewrites the container to 100 % and adds an iframe.
  await p.route(/s3\.tradingview\.com\/.*advanced-chart/, (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `(()=>{const c=document.currentScript.parentElement;c.style.cssText="height:100%;width:100%";const f=document.createElement("iframe");f.style.cssText="display:block;height:100%;width:100%";c.replaceChildren(f);})();`,
    }),
  );
  await p.goto(base + "/stock/AAPL?tab=chart");
  await p.locator(".tradingview-widget-container iframe").waitFor({ state: "attached" });
  const h = await p.locator(".tradingview-widget-container iframe").evaluate((f) => f.getBoundingClientRect().height);
  assert(h >= 400, `chart is ${h}px tall`);
  await p.context().close();
});

// ---- Chart packs, earnings date, methodology ------------------------------------------------

/** A company's SEC series for tests: steady growth, a seed per symbol so peers differ. */
function packSeries(symbol) {
  const seed = [...symbol].reduce((a, c) => a + c.charCodeAt(0), 0) % 7;
  const years = Array.from({ length: 11 }, (_, i) => 2015 + i);
  const rev = years.map((_, i) => 100e9 * (1 + 0.05 + seed / 100) ** i);
  const annual = {
    keys: years.map((y) => `FY${y}`),
    ends: years.map((y) => `${y}-12-31`),
    values: {
      revenue: rev,
      netIncome: rev.map((r) => r * 0.2),
      grossMargin: rev.map((_, i) => 0.4 + seed / 100 + i / 500),
      operatingMargin: rev.map(() => 0.25 + seed / 100),
      netMargin: rev.map(() => 0.2),
      freeCashFlow: rev.map((r) => r * 0.18),
      eps: rev.map((r) => r / 1e10),
      roic: rev.map((_, i) => 0.12 + seed / 50 + i / 200),
      shares: rev.map((_, i) => 1e10 * (1 - i / 100)),
      debtToEquity: rev.map(() => 0.5 + seed / 10),
    },
  };
  return { symbol, name: `${symbol} Inc.`, annual, quarterly: { keys: [], ends: [], values: {} } };
}

async function withSeries(p, peers = ["MSFT", "GOOGL", "META", "AMZN"]) {
  await p.route(/\/api\/sec\/series\//, (r) => {
    const s = decodeURIComponent(r.request().url().split("/series/")[1]);
    r.fulfill(json({ ok: true, data: packSeries(s), fetchedAt: new Date().toISOString() }));
  });
  await p.route(/\/api\/sec\/peers\//, (r) => r.fulfill(json({ ok: true, data: { symbol: "AAPL", sicDescription: "Computers", peers }, fetchedAt: new Date().toISOString() })));
}

await test("chart packs: a built-in pack opens for any company with growth readouts and a peer median", async () => {
  const p = await page();
  await withSeries(p);
  await p.goto(base + "/charts/packs?s=AAPL");
  await p.getByRole("heading", { level: 1, name: "Paquetes de gráficos: AAPL" }).waitFor();
  const cards = p.locator("main section, main [id]").filter({ has: p.locator("h2") });
  await p.getByText("al año en 9 años", { exact: false }).first().waitFor();
  await p.getByText("Las mayores empresas de su industria", { exact: false }).first().waitFor();
  assert((await p.getByText("Mediana de pares").count()) > 0, "no peer median");
  assert((await cards.count()) >= 8, `cards ${await cards.count()}`);
  await p.getByLabel("Paquete", { exact: true }).selectOption("quarters");
  await p.waitForURL(/p=quarters/);
  await axe(p);
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("chart packs: save a chart from the generator, open it for another company, reorder, remove, delete and undo", async () => {
  const p = await page();
  await withSeries(p);
  await p.goto(base + "/charts?s=AAPL&m=roic&f=annual&k=line&r=10");
  await p.getByRole("button", { name: "Mediana de pares" }).click();
  await p.waitForURL(/p=1/);
  await p.locator("main svg").first().waitFor();
  await p.locator("summary", { hasText: "Guardar en un paquete" }).click();
  await p.getByLabel("Nombre del nuevo paquete").fill("Mi foso");
  await p.getByRole("button", { name: "Crear y guardar" }).click();
  await p.getByText("Añadido a «Mi foso».").waitFor();
  await p.goto(base + "/charts?s=AAPL&m=revenue&f=annual&k=bar&r=10");
  await p.locator("summary", { hasText: "Guardar en un paquete" }).click();
  await p.getByRole("button", { name: /^Mi foso/ }).click();
  await p.getByText("Añadido a «Mi foso».").waitFor();
  const packs = await p.evaluate(() => JSON.parse(localStorage.getItem("iep.chartpacks")));
  assert(packs.length === 1 && packs[0].charts.length === 2 && packs[0].charts[0].peers === true, JSON.stringify(packs));
  await p.goto(base + `/charts/packs?s=MSFT&p=${packs[0].id}`);
  await p.getByRole("heading", { level: 1, name: "Paquetes de gráficos: MSFT" }).waitFor();
  await p.getByRole("button", { name: "Mover antes" }).nth(1).click();
  const order = await p.evaluate(() => JSON.parse(localStorage.getItem("iep.chartpacks"))[0].charts.map((c) => c.metrics[0]));
  assert(order.join() === "revenue,roic", `order ${order}`);
  await p.getByRole("button", { name: "Quitar este gráfico del paquete" }).first().click();
  await p.getByRole("button", { name: "Borrar paquete" }).click();
  await p.waitForURL(/p=essentials/);
  await p.getByRole("button", { name: "Deshacer" }).click();
  const back = await p.evaluate(() => JSON.parse(localStorage.getItem("iep.chartpacks")));
  assert(back.length === 1 && back[0].charts.length === 1, `after undo ${JSON.stringify(back)}`);
  await p.context().close();
});

await test("chart packs: phone layout never scrolls sideways", async () => {
  const p = await page({ width: 320, height: 640, touch: true });
  await withSeries(p);
  await p.goto(base + "/charts/packs?s=AAPL");
  await p.getByText("al año en 9 años", { exact: false }).first().waitFor();
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(over <= 0, `page overflows by ${over}px`);
  await p.context().close();
});

await test("next earnings: a listed date with estimates, an SEC estimate labelled as such, nothing when unknown", async () => {
  const p = await page();
  let answer = { ok: true, data: { symbol: "AAPL", next: { kind: "listed", date: "2099-02-04", epsEstimate: 2.9, revenueEstimate: 156e9 }, fmpIssue: null }, fetchedAt: new Date().toISOString() };
  await p.route(/\/api\/earnings\//, (r) => r.fulfill(json(answer)));
  await p.goto(base + "/stock/AAPL");
  await p.locator("[data-earnings=listed]").getByText("Próximos resultados: 4 feb 2099", { exact: false }).waitFor();
  await p.getByText("BPA esperado por los analistas: $2.90", { exact: false }).waitFor();
  answer = { ok: true, data: { symbol: "MSFT", next: { kind: "estimated", date: "2099-01-28", basedOn: "2098-01-29" }, fmpIssue: "rate_limited" }, fetchedAt: new Date().toISOString() };
  await p.goto(base + "/stock/MSFT");
  await p.locator("[data-earnings=estimated]").getByText("hacia el", { exact: false }).waitFor();
  await p.getByText("Estimado: un año después de los resultados", { exact: false }).waitFor();
  answer = { ok: true, data: { symbol: "KO", next: { kind: "unknown" }, fmpIssue: "not_found" }, fetchedAt: new Date().toISOString() };
  await p.goto(base + "/stock/KO");
  await p.getByRole("heading", { level: 1 }).waitFor();
  await p.waitForTimeout(500);
  assert((await p.locator("[data-earnings]").count()) === 0, "unknown date shown");
  await p.context().close();
});

await test("methodology: reachable from the footer, contents link to sections, in both languages", async () => {
  const p = await page();
  await p.goto(base + "/");
  await p.getByRole("link", { name: "Cómo calculamos cada número" }).click();
  await p.waitForURL(/\/methodology/);
  await p.getByRole("heading", { level: 1, name: "Metodología" }).waitFor();
  await p.getByRole("navigation", { name: "Contenido" }).getByRole("link", { name: "Calidad: las pruebas de Buffett" }).click();
  await p.waitForURL(/#quality/);
  await p.getByText("ROIC de al menos 15 % en el 80 % de los años.").waitFor();
  await axe(p);
  const en = await page({ lang: "en", theme: "dark" });
  await en.goto(base + "/methodology");
  await en.getByRole("heading", { level: 1, name: "Methodology" }).waitFor();
  await axe(en);
  await en.context().close();
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
  const thesisText = `Pricing power and a global distribution moat (${Date.now()}).`; // unique: the demo store outlives a run
  await thesis.fill(thesisText);
  await p.getByLabel("Bull case").fill("Brand\nDividend growth");
  await p.getByLabel("Fair value", { exact: true }).fill("75");
  await p.getByText("Unsaved changes").waitFor();
  await p.getByRole("button", { name: "Save" }).click();
  await p.getByText(/^Saved ·/).waitFor();
  // The header shows the fair value against the price; the history records it.
  await p.getByTestId("fair-value-line").getByText("Your fair value: $75.00").waitFor();
  await p.getByRole("region", { name: "Your fair value over time" }).getByText("By hand").waitFor();
  // A dated note, then a reload: everything is still there.
  const note = `Q3: volumes up in Latin America (${Date.now()})`;
  await p.getByLabel("New note").fill(note);
  await p.getByRole("button", { name: "Add note" }).click();
  await p.getByText(note).waitFor();
  await p.reload();
  await p.getByLabel("Thesis").waitFor();
  assert((await p.getByLabel("Thesis").inputValue()).startsWith("Pricing power"), "thesis not kept");
  await axe(p);
  // The overview card and the list page show it too.
  await p.getByRole("tab", { name: "Overview" }).click();
  await p.locator("#research-card").getByText(thesisText).waitFor();
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
  const run = Date.now(); // the demo store lives as long as the server: make this run's text unique
  await b.getByLabel("Thesis").fill(`Written in tab B ${run}`);
  await b.getByRole("button", { name: "Save" }).click();
  await b.getByText(/^Saved ·/).waitFor();
  await a.getByLabel("Thesis").fill(`Written in tab A ${run}`);
  await a.getByRole("button", { name: "Save" }).click();
  await a.getByText(/changed on another device/).waitFor();
  assert((await a.getByLabel("Thesis").inputValue()) === `Written in tab A ${run}`, "draft lost");
  await a.getByRole("button", { name: "Reload" }).waitFor();
  await a.context().close();
});

// ---- Screener and quarter in review (SEC endpoints answered with fixtures) ----------------------

const screenRow = (symbol, rank, industry, ratios) => ({
  symbol, name: `${symbol} Inc.`, cik: rank, rank, sic: 7372, industry, type: "general", revenue: 1e9 * (10 - rank),
  ratios: { revenueGrowth: null, grossMargin: null, operatingMargin: null, netMargin: null, fcfMargin: null, roic: null, roe: null, debtToEquity: null, epsGrowth: null, ...ratios },
});

await test("screener: quick screens, filters and sorting drive the request; results link to stocks", async () => {
  const p = await page({ lang: "en" });
  const asked = [];
  await p.route(/\/api\/sec\/screener/, (r) => {
    asked.push(new URL(r.request().url()).search);
    r.fulfill(json({ ok: true, fetchedAt: "2026-11-08T07:00:00Z", data: { year: 2025, updatedAt: "2026-11-08T07:00:00Z", total: 4821, matched: 2, rows: [
      screenRow("SOFT", 1, "SERVICES-PREPACKAGED SOFTWARE", { roic: 0.31, grossMargin: 0.8, debtToEquity: 0.1, fcfMargin: 0.35 }),
      screenRow("CHIP", 2, "SEMICONDUCTORS & RELATED DEVICES", { roic: 0.22, grossMargin: 0.55, debtToEquity: 0.3, fcfMargin: 0.2 }),
    ] } }));
  });
  await p.goto(base + "/screener");
  await p.getByText("2 of 4,821 companies match").waitFor();
  await p.getByRole("button", { name: "Quality" }).click();
  await p.waitForURL(/roic=15/);
  await p.waitForFunction(() => true);
  await p.getByRole("button", { name: "Quality" }).and(p.locator("[aria-pressed=true]")).waitFor();
  assert(asked.some((q) => q.includes("roic=15") && q.includes("gm=40") && q.includes("de=0.5")), `requests ${asked.join(" | ")}`);
  // A threshold typed by hand, then a sort on a column.
  await p.getByLabel("Revenue growth (min)").fill("10");
  await p.waitForURL(/rg=10/);
  await p.getByRole("button", { name: "Sort by ROIC" }).click();
  await p.waitForURL(/dir=asc/);
  assert((await p.locator("th[aria-sort=ascending]").count()) === 1, "sorted column not marked");
  // Save the screen, clear, reopen it.
  await p.getByRole("button", { name: "Save screen" }).click();
  await p.getByLabel("Screen name").fill("My quality");
  await p.getByLabel("Screen name").press("Enter");
  await p.getByRole("button", { name: "Clear filters" }).click();
  await p.waitForURL((u) => !u.search.includes("roic"));
  await p.getByRole("button", { name: "My quality", exact: true }).click();
  await p.waitForURL(/roic=15/);
  const link = p.getByRole("link", { name: /SOFT/ });
  assert((await link.getAttribute("href")) === "/stock/SOFT", "row link");
  // Results dim while a new screen loads; check contrast once they're settled.
  await p.waitForFunction(() => !document.querySelector("[aria-busy=true]"));
  await p.waitForTimeout(250); // the fade back to full opacity
  await axe(p);
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("screener: on a phone the results scroll inside their box, never the page", async () => {
  const p = await page({ width: 360, height: 780, touch: true });
  await p.route(/\/api\/sec\/screener/, (r) => r.fulfill(json({ ok: true, fetchedAt: "2026-11-08T07:00:00Z", data: { year: 2025, updatedAt: "2026-11-08T07:00:00Z", total: 10, matched: 1, rows: [screenRow("SOFT", 1, "SERVICES-PREPACKAGED SOFTWARE", { roic: 0.31 })] } })));
  await p.goto(base + "/screener");
  await p.getByRole("link", { name: /SOFT/ }).waitFor();
  assert((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, "horizontal overflow");
  await axe(p);
  await p.context().close();
});

await test("quarter in review: the latest quarter against a year ago and the quarter before, with its reports", async () => {
  const p = await page({ lang: "en" });
  const row = (key, now, yearAgo, prior, vsYearAgo, vsPrior) => ({ key, now, yearAgo, prior, vsYearAgo, vsPrior });
  await p.route(/\/api\/sec\/quarter\//, (r) => r.fulfill(json({ ok: true, fetchedAt: "2026-11-08T07:00:00Z", data: { symbol: "AAPL", cik: 320193, review: {
    quarter: "2026-Q3", label: "Q4 FY2026", end: "2026-09-26", yearAgoLabel: "Q4 FY2025", priorLabel: "Q3 FY2026",
    filing: { accn: "0000320193-26-000026", form: "10-K", filed: "2026-10-30" },
    rows: [row("revenue", 114.477e9, 102.466e9, 109.4e9, 0.1172, 0.0462), row("grossMargin", 0.4789, 0.4718, 0.5005, 0.0071, -0.0217), row("eps", null, null, 1.57, null, null)],
  } } })));
  await p.route(/\/api\/sec\/filings\//, (r) => r.fulfill(json({ ok: true, fetchedAt: "2026-11-08T07:00:00Z", data: { cik: 320193, older: { available: false, loaded: false, from: null }, filings: [
    { accn: "0000320193-26-000025", form: "8-K", filed: "2026-10-30", reportDate: "2026-10-30", primaryDocument: "aapl-8k.htm", description: "8-K", items: ["2.02", "9.01"], inlineXbrl: true },
  ] } })));
  await p.goto(base + "/stock/AAPL");
  const card = p.locator("#quarter");
  await card.getByText("Revenue +11.7% versus the same quarter a year ago.").waitFor();
  await card.getByText("+0.7 pts").waitFor(); // margins in points
  assert((await card.getByRole("columnheader").allInnerTexts()).join("|").includes("vs. Q4 FY2025"), "year-ago column");
  assert((await card.getByRole("link", { name: /10-K report/ }).getAttribute("href")).endsWith("/0000320193-26-000026-index.htm"), "10-K link");
  assert((await card.getByRole("link", { name: /Earnings release/ }).getAttribute("href")).endsWith("/aapl-8k.htm"), "release link");
  await axe(p);
  await p.context().close();
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
