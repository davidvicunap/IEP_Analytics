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
// ONLY="live thesis" runs the matching journeys; several names separated by "|" run each (CI's smoke set).
const only = process.env.ONLY ? process.env.ONLY.split("|").map((s) => s.trim()).filter(Boolean) : null;
async function test(name, fn) {
  if (only && !only.some((o) => name.includes(o))) return;
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`✗ ${name}\n    ${String(e?.message ?? e).split("\n").slice(0, process.env.ONLY || process.env.VERBOSE ? 6 : 1).join("\n    ")}`);
  }
}
/** Waits until a condition holds (it may be async, e.g. a control's value, or a request the test saw). */
async function until(cond, msg, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(typeof msg === "function" ? await msg() : msg);
    await new Promise((r) => setTimeout(r, 50));
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const browser = await chromium.launch();
async function page({ width = 1280, height = 900, lang = "es", theme = "light", watchlist = [], touch = false, planMode = "form" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, locale: lang === "es" ? "es-US" : "en-US" });
  await ctx.addCookies([{ name: "lang", value: lang, url: base }]);
  await ctx.addInitScript(
    ([theme, list, planMode]) => {
      if (!sessionStorage.getItem("seeded")) {
        // An empty notebook opens on the guided plan; journeys use the form unless they test the guide.
        if (planMode) localStorage.setItem("iep.planMode", planMode);
        localStorage.setItem("iep.theme", theme);
        localStorage.setItem("iep.watchlist", JSON.stringify(list));
        sessionStorage.setItem("seeded", "1");
      }
    },
    [theme, watchlist, planMode],
  );
  await ctx.route(/tradingview\.com/, (r) => r.abort());
  await ctx.route(/\/api\/prefs/, (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not_configured" }) }));
  await ctx.route(/\/api\/(sec|valuation)\//, (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not_configured" }) }));
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
// The stock search (other selects on the page are comboboxes too).
const searchBox = (p) => p.getByRole("combobox", { name: /Buscar una acción|Search a stock/ });
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
  const box = searchBox(p);
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
  const box = searchBox(p);
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
  const box = searchBox(p);
  await box.fill("coca cola"); // not ticker-shaped, so Enter can't fall back to opening a ticker
  await p.getByTestId("search-popup").getByText("La búsqueda no está disponible en este momento.").waitFor();
  fail = false;
  await box.press("Enter");
  await p.getByRole("option", { name: /Coca-Cola/ }).waitFor();
  await p.unroute(/\/api\/search/);
  await p.route(/\/api\/search/, (r) => r.fulfill(json([])));
  await box.fill("qqqzzz");
  await p.getByTestId("search-popup").getByText("No encontramos «qqqzzz».").waitFor();
  await p.context().close();
});

await test("search: keyboard selection, Escape and focus", async () => {
  const p = await page();
  await p.route(/\/api\/search/, (r) => r.fulfill(json([{ symbol: "MSFT", name: "Microsoft" }, { symbol: "MSTR", name: "MicroStrategy" }])));
  await p.goto(base + "/stock/AAPL");
  await p.keyboard.press("/"); // shortcut focuses the header search
  const box = searchBox(p);
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
    // On <body>, fixed: React re-rendering <main> as the page streams in can't remove it.
    Object.assign(d.style, { position: "fixed", top: "120px", left: "20px", zIndex: "100", background: "white", padding: "8px" });
    document.body.append(d);
  });
  await p.click("#ed");
  await p.keyboard.press("/");
  assert(await p.evaluate(() => document.activeElement?.id === "ed"), "/ stole focus from contenteditable");
  await p.keyboard.press("Control+k");
  assert(await p.evaluate(() => document.activeElement?.getAttribute("role") === "combobox"), "Ctrl+K didn't focus search");
  await p.context().close();
});

await test("command palette: Ctrl+K goes to a stock's section, follows it, switches theme and opens pages, by keyboard", async () => {
  const p = await page({ lang: "en" });
  await p.goto(base + "/stock/AAPL");
  await p.getByRole("heading", { name: "Apple Inc." }).waitFor();
  // A key pressed before the page's scripts are running does nothing: press again until it opens
  // (Ctrl+K toggles, so only once the dialog has had time to appear).
  const open = async () => {
    const dialog = p.getByRole("dialog", { name: "Commands" });
    for (let i = 0; i < 5; i++) {
      await p.keyboard.press("Control+k");
      if (await dialog.waitFor({ timeout: 2000 }).then(() => true, () => false)) return;
    }
    await dialog.waitFor();
  };
  const box = () => p.getByRole("combobox", { name: "Type a command, an action or a company" });
  // A ticker and a section, in any order.
  await open();
  await box().fill("dcf msft");
  await p.getByRole("option", { name: /MSFT · Reverse DCF/ }).waitFor();
  await axe(p);
  await p.keyboard.press("Enter");
  await p.waitForURL(/\/stock\/MSFT\?tab=valuation$/);
  await p.getByRole("button", { name: "Comps", pressed: true }).waitFor();
  // A section alone means the stock on screen; arrows move, Enter runs.
  await open();
  await box().fill("insiders");
  await p.getByRole("option", { name: /MSFT · Insiders/ }).waitFor();
  await p.keyboard.press("Enter");
  await p.waitForURL(/view=insiders/);
  // Follow it, then dark theme.
  await open();
  await box().fill("follow");
  await p.getByRole("option", { name: /Follow MSFT/ }).waitFor();
  await p.keyboard.press("Enter");
  await p.getByText("MSFT is in your list.").waitFor();
  assert((await p.evaluate(() => JSON.parse(localStorage.getItem("iep.watchlist")))).includes("MSFT"), "not followed");
  await open();
  await box().fill("dark");
  await p.getByRole("option", { name: /Dark theme/ }).waitFor();
  await p.keyboard.press("Enter");
  assert((await p.evaluate(() => document.documentElement.dataset.theme)) === "dark", "theme not applied");
  // Escape closes and gives the focus back; the button opens it too.
  await open();
  await p.keyboard.press("Escape");
  await p.getByRole("dialog", { name: "Commands" }).waitFor({ state: "detached" });
  await p.getByRole("button", { name: /^Commands/ }).click();
  await box().fill("screener");
  await p.getByRole("option", { name: /Stock screener/ }).click();
  await p.waitForURL(/\/screener$/);
  // Nothing matches: it says so and suggests a form that works.
  await open();
  await box().fill("zzzz qqqq xx");
  await p.getByText(/Try a ticker and a section/).waitFor();
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("navigation: research, canvas and screener; More holds the method; the old portfolio and list addresses open the hub; a sheet on phones", async () => {
  const p = await page({ lang: "en" });
  await p.goto(base + "/");
  await p.getByRole("heading", { level: 1, name: "My research" }).waitFor();
  const nav = p.getByRole("navigation", { name: /main/i }).first();
  for (const name of ["Research", "Canvas", "Screener"]) assert((await nav.getByRole("link", { name, exact: true }).count()) === 1, `${name} in the nav`);
  // Tools left out of the MVP aren't offered (their pages still open by URL).
  await nav.getByRole("button", { name: "More" }).click();
  await p.getByRole("link", { name: /How we calculate\s*Where every number/ }).waitFor();
  assert((await p.getByRole("link", { name: /Compare|Calendar|Chart packs|My portfolio/ }).count()) === 0, "removed tools offered");
  await axe(p);
  await p.goto(base + "/portfolio");
  await p.waitForURL((u) => u.pathname === "/");
  await p.goto(base + "/watchlist");
  await p.waitForURL((u) => u.pathname === "/");
  await p.goto(base + "/research");
  await p.waitForURL((u) => u.pathname === "/");
  await p.context().close();

  const m = await page({ lang: "es", width: 390, height: 800, touch: true });
  await m.goto(base + "/");
  const bar = m.getByRole("navigation", { name: /principal/i }).last();
  for (const name of ["Mi análisis", "Lienzo", "Buscador"]) await bar.getByRole("link", { name }).waitFor();
  assert((await bar.getByRole("link", { name: "Mi lista" }).count()) === 0, "the old list is still in the bar");
  await bar.getByRole("button", { name: "Más" }).click();
  const sheet = m.getByRole("dialog", { name: "Más" });
  await sheet.getByRole("link", { name: /Cómo calculamos/ }).waitFor();
  await sheet.getByRole("button", { name: "Comandos y atajos" }).click();
  await m.getByRole("dialog", { name: "Comandos" }).waitFor();
  await m.context().close();
});

await test("stock page: the thesis is the main action; its tab shows only the plan until there's something to add trades and notes to", async () => {
  const p = await page({ lang: "en", planMode: "" }); // an empty notebook opens on the guided plan
  const blank = { symbol: "AAPL", thesis: "", bull: "", bear: "", fairValue: null, entry: null, stop: null, target: null, direction: "up", reviewBy: null, checks: [], opened: null, closed: null, log: [], updatedAt: null };
  let note = blank;
  await p.route(/\/api\/research\/AAPL$/, (r) => (r.request().method() === "GET" ? r.fulfill(json({ ok: true, fetchedAt: "x", data: note })) : r.continue()));
  await p.route(/\/api\/trades$/, (r) => r.fulfill(json({ ok: true, fetchedAt: "x", data: [] })));
  await p.goto(base + "/stock/AAPL");
  const main = p.getByTestId("thesis-button");
  await main.getByText("Write my thesis").waitFor();
  assert((await main.getAttribute("class")).includes("bg-accent"), "the thesis button is the page's primary action");
  assert((await p.locator("#research-card").count()) === 0, "an empty thesis card on the overview");
  await main.click();
  await p.waitForURL(/tab=research/);
  await p.getByRole("heading", { name: "Why does AAPL interest you?" }).waitFor();
  assert((await p.locator("#trades").count()) === 0, "trades offered before there's a thesis");
  assert((await p.getByRole("heading", { name: "Dated notes" }).count()) === 0, "dated notes offered before there's a thesis");
  await axe(p);
  // Once saved: the button goes back to it, and trades and notes join the tab.
  note = { ...blank, thesis: "Services keep growing.", fairValue: 250, updatedAt: "2026-11-20T00:00:00Z" };
  await p.goto(base + "/stock/AAPL");
  await main.getByText("My thesis").waitFor();
  await p.locator("#research-card").getByText("Services keep growing.").waitFor();
  await main.click();
  await p.locator("#trades").waitFor();
  await p.getByRole("heading", { name: "Dated notes" }).waitFor();
  // Phones: the thesis button fills the row; the canvas and follow buttons are icons with names.
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(base + "/stock/AAPL");
  await main.waitFor();
  assert((await p.getByRole("link", { name: "Canvas" }).first().isVisible()) && (await p.getByRole("button", { name: "Follow" }).first().isVisible()), "icon buttons keep their names");
  const box = await main.boundingBox();
  assert(box && box.width > 150 && box.height >= 44, `thesis button ${JSON.stringify(box)}`);
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("research hub: how to start when empty; theses with today's price and their canvas; a stock opens its canvas or starts one", async () => {
  const p = await page({ lang: "en" });
  let notes = [];
  await p.route(/\/api\/research$/, (r) => r.fulfill(json({ ok: true, fetchedAt: "x", data: notes })));
  await p.route(/\/api\/trades$/, (r) => r.fulfill(json({ ok: true, fetchedAt: "x", data: [] }))); // the demo store outlives a run
  await p.goto(base + "/");
  await p.getByRole("heading", { level: 1, name: "My research" }).waitFor();
  await p.getByRole("heading", { name: "How it works" }).waitFor();
  await p.getByText("No canvases yet.", { exact: false }).waitFor();
  assert((await p.getByRole("link", { name: "New canvas" }).getAttribute("href")) === "/canvas?new=1", "new canvas");
  await axe(p);
  // A thesis on KO and a canvas showing KO.
  const note = (symbol, thesis, fairValue) => ({ symbol, thesis, bull: "", bear: "", fairValue, entry: null, stop: null, target: null, direction: "up", reviewBy: null, checks: [], opened: null, closed: null, log: [], updatedAt: "2026-11-20T00:00:00Z" });
  notes = [note("KO", "Pricing power holds.", 80), note("MSFT", "Cloud keeps compounding.", null)];
  await p.evaluate(() =>
    localStorage.setItem("iep.canvases", JSON.stringify([{ id: "c-ko", name: "KO desk", view: { x: 0, y: 0, zoom: 1 }, updatedAt: "2026-11-20T12:00:00.000Z", widgets: [{ id: "w-1", kind: "glance", x: 0, y: 0, w: 400, h: 464, z: 1, symbol: "KO", link: 1 }] }])),
  );
  await p.reload();
  const theses = p.getByRole("region", { name: "Your companies" }).or(p.locator("section", { has: p.getByRole("heading", { name: "Your companies" }) }));
  await theses.getByText("Pricing power holds.").waitFor();
  assert((await p.getByRole("link", { name: "Open the canvas for KO" }).getAttribute("href")) === "/canvas?c=c-ko", "KO's canvas");
  assert((await p.getByRole("link", { name: "Open MSFT in a new canvas" }).getAttribute("href")) === "/canvas?new=1&s=MSFT", "MSFT starts one");
  await p.getByRole("link", { name: /KO desk/ }).waitFor();
  await axe(p);
  // From a stock page: KO opens its canvas; MSFT starts a new one with MSFT picked.
  await p.goto(base + "/canvas?s=KO");
  await p.getByText("KO desk").first().waitFor();
  await p.goto(base + "/canvas?s=MSFT");
  await p.getByTestId("start-symbol").getByText("MSFT").waitFor();
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("chart indicators: chosen once, every TradingView chart opens with them (stock page and canvas), kept on reload", async () => {
  const p = await page({ lang: "en" });
  await p.route(/tradingview\.com|tradingview-widget\.com/, (r) => r.abort());
  const embedded = () => p.evaluate(() => [...document.querySelectorAll(".tradingview-widget-container script")].map((s) => JSON.parse(s.textContent || "{}").studies ?? null));
  await p.goto(base + "/stock/AAPL");
  // One small menu, not a wall of chips: closed until asked for, closed again with Escape.
  const menu = p.getByTestId("studies-menu");
  await menu.click();
  const box = p.getByRole("group", { name: "Saved indicators" });
  await box.getByRole("checkbox", { name: "RSI", exact: true }).check();
  await box.getByRole("checkbox", { name: "Bollinger Bands" }).check();
  await until(async () => JSON.stringify(await embedded()) === JSON.stringify([["BB@tv-basicstudies", "RSI@tv-basicstudies"]]), "stock chart studies");
  await axe(p);
  await p.keyboard.press("Escape");
  await box.waitFor({ state: "detached" });
  assert((await menu.innerText()).includes("2"), "the menu shows how many are on");
  await p.reload();
  await p.getByTestId("studies-menu").click();
  assert(await p.getByRole("group", { name: "Saved indicators" }).getByRole("checkbox", { name: "RSI", exact: true }).isChecked(), "kept on reload");
  // A canvas chart window opens with the same indicators, and the canvas bar has the same menu.
  await p.evaluate(() => localStorage.setItem("iep.canvases", JSON.stringify([{ id: "c-tv", name: "TV", view: { x: 0, y: 0, zoom: 1 }, updatedAt: "2026-11-20T12:00:00.000Z", widgets: [{ id: "w-1", kind: "chart", x: 0, y: 0, w: 640, h: 400, z: 1, symbol: "AAPL", link: 1, interval: "D" }] }])));
  await p.goto(base + "/canvas?c=c-tv");
  await until(async () => JSON.stringify(await embedded()) === JSON.stringify([["BB@tv-basicstudies", "RSI@tv-basicstudies"]]), "canvas chart studies");
  await p.getByTestId("studies-menu").click();
  assert(await p.getByRole("group", { name: "Saved indicators" }).getByRole("checkbox", { name: "Bollinger Bands" }).isChecked(), "canvas menu shows the same list");
  await p.evaluate(() => localStorage.removeItem("iep.chartstudies"));
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("search: touch selection on a phone (expandable header search)", async () => {
  const p = await page({ width: 375, height: 740, touch: true });
  await p.route(/\/api\/search/, (r) => r.fulfill(json([{ symbol: "NVDA", name: "NVIDIA" }])));
  await p.goto(base + "/stock/AAPL");
  await p.getByRole("button", { name: "Buscar" }).tap();
  const box = searchBox(p);
  await box.fill("nvi");
  await p.getByRole("option", { name: /NVIDIA/ }).tap();
  await p.waitForURL(/\/stock\/NVDA/);
  await p.context().close();
});

// ---- Your companies (the hub's one list: theses, holdings and followed stocks) ---------------

const many = Array.from({ length: 45 }, (_, i) => `W${String.fromCharCode(65 + (i % 26))}${i >= 26 ? "Q" : ""}`);

/** The hub with nothing but the followed list (the demo store's notebooks and trades outlive a run). */
async function hubWithFollowed(opts) {
  const p = await page(opts);
  await p.route(/\/api\/research$/, (r) => r.fulfill(json({ ok: true, fetchedAt: "x", data: [] })));
  await p.route(/\/api\/trades$/, (r) => r.fulfill(json({ ok: true, fetchedAt: "x", data: [] })));
  return p;
}

await test("your companies: 45 followed stocks are all listed and priced, in quote pages of at most 30", async () => {
  const p = await hubWithFollowed({ watchlist: many });
  const sizes = [];
  p.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/quotes") sizes.push(decodeURIComponent(u.searchParams.get("symbols")).split(",").length);
  });
  await p.goto(base + "/");
  await p.waitForFunction(() => document.querySelectorAll("[data-testid^='company-']").length === 45);
  await p.waitForFunction(() => [...document.querySelectorAll("[data-testid^='company-']")].every((li) => li.textContent.includes("$")));
  assert(sizes.every((n) => n <= 30) && sizes.reduce((a, b) => a + b, 0) === 45, `pages ${sizes}`);
  await p.getByTestId("company-WA").getByText("Siguiendo").waitFor();
  await p.context().close();
});

await test("your companies: missing prices and an expired beta session are said plainly", async () => {
  const p = await hubWithFollowed({ watchlist: ["AAPL", "MSFT", "KO"] });
  let mode = "partial";
  await p.route(/\/api\/quotes/, async (r) => {
    if (mode === "401") return r.fulfill(json({ error: "beta_required" }, 401));
    const res = await r.fetch();
    const body = await res.json();
    body.quotes = body.quotes.filter((q) => q.symbol !== "KO");
    body.missing = [{ symbol: "KO", error: "rate_limited" }];
    r.fulfill(json(body));
  });
  await p.goto(base + "/");
  await p.getByText("No pudimos cargar 1 de 3 precios.", { exact: false }).waitFor();
  assert((await p.getByTestId("company-AAPL").getByText("$").count()) > 0, "AAPL lost its price");
  mode = "401";
  await p.reload();
  await p.getByText("Tu acceso a la beta caducó", { exact: false }).first().waitFor();
  await p.context().close();
});

await test("your companies: following from a stock page puts it on the hub; unfollowing can be undone", async () => {
  const p = await hubWithFollowed({ watchlist: ["AAPL"] });
  await p.goto(base + "/stock/NVDA");
  await p.getByRole("button", { name: "Seguir", exact: true }).click();
  await p.getByText("Sigues NVDA: está en tus empresas", { exact: false }).waitFor();
  assert((await p.getByRole("button", { name: "Siguiendo" }).getAttribute("aria-pressed")) === "true", "not pressed");
  await p.getByRole("button", { name: "Siguiendo" }).click();
  await p.getByText("Dejaste de seguir NVDA.").waitFor();
  await p.getByRole("button", { name: "Deshacer" }).click();
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("iep.watchlist")));
  assert(JSON.stringify(saved) === JSON.stringify(["AAPL", "NVDA"]), `after undo: ${saved}`);
  await p.goto(base + "/");
  await p.getByTestId("company-NVDA").getByText("Siguiendo").waitFor();
  // The old list's address opens the hub.
  await p.goto(base + "/watchlist");
  await p.waitForURL((u) => u.pathname === "/");
  await p.context().close();
});

await test("your companies: corrupted storage is cleaned up, not fatal", async () => {
  const p = await hubWithFollowed({ watchlist: ["aapl", "AAPL", 7, "<b>", "ko"] });
  await p.goto(base + "/");
  await p.waitForFunction(() => document.querySelectorAll("[data-testid^='company-']").length === 2);
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("your companies: each row says the next thing to know (a new filing, results soon); a failed SEC summary leaves it quiet", async () => {
  const p = await hubWithFollowed({ watchlist: ["AAPL", "MSFT", "KO"], lang: "en" });
  const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const snap = (symbol, o) => ({
    symbol,
    cik: 1,
    quality: { ok: false, error: "not_found" },
    filings: { ok: true, data: { report: null, latest: null, recent: o.recent ?? [], nextResults: o.next ? { date: o.next, basedOn: day(-355) } : null } },
    insiders: { ok: false, error: "not_found" },
  });
  await p.route(/\/api\/sec\/snapshot\//, (r) => {
    const s = decodeURIComponent(r.request().url().split("/snapshot/")[1]);
    if (s === "KO") return r.fulfill(json({ ok: false, error: "upstream" }, 502));
    const o = s === "AAPL" ? { recent: [{ accn: "0000320193-26-000099", form: "8-K", filed: day(-2), reportDate: null, primaryDocument: "a.htm", items: [] }] } : { next: day(10) };
    return r.fulfill(json({ ok: true, data: snap(s, o), fetchedAt: new Date().toISOString() }));
  });
  await p.goto(base + "/");
  await p.getByTestId("company-AAPL").getByText(/^New 8-K filed /).waitFor();
  await p.getByTestId("company-MSFT").getByText(/^Results around .* \(in 10 days\)$/).waitFor();
  await p.getByTestId("company-KO").waitFor();
  assert((await p.getByTestId("company-KO").locator("[data-next]").count()) === 0, "a failed summary made up a next event");
  await axe(p);
  await p.context().close();
});

await test("your companies: a phone keeps the page from scrolling sideways", async () => {
  const p = await hubWithFollowed({ watchlist: ["AAPL", "MSFT", "KO"], width: 320, height: 640, touch: true });
  await p.goto(base + "/");
  await p.getByTestId("company-KO").waitFor();
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(over <= 0, `page overflows by ${over}px`);
  await p.context().close();
});

await test("against its industry: one table with the industry's median, where the company stands and its own 10 years; gaps said in words", async () => {
  const p = await page({ lang: "en" });
  const row = (key, group, value, o = {}) => ({
    key, group, better: o.better ?? "higher", applicable: o.applicable ?? true, value, note: o.note ?? null,
    history: [{ label: "FY2024", value: value ? value * 0.9 : null }, { label: "FY2025", value }],
    own: o.own === null ? null : { percentile: 95, median: value ? value * 0.8 : 0, n: 10 },
    sector: o.sector === null ? null : { percentile: 97, median: 0.143, n: 62, sicPrefix: "35" },
  });
  await p.route(/\/api\/sec\/ratios\//, (r) =>
    r.fulfill(json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      data: {
        symbol: "AAPL", cik: 320193, businessType: "general", sic: 3571, sicDescription: "Electronic computers",
        period: { label: "FY2025", end: "2025-09-27" }, peersYear: 2025,
        ratios: [
          row("operatingMargin", "profitability", 0.33),
          row("roic", "returns", 0.69, { sector: null }),
          row("debtToEquity", "health", 0.61, { better: "lower", own: null }),
          row("revenueGrowth", "growth", null),
          row("equityToAssets", "health", 0.2, { applicable: false }),
        ],
      },
    })),
  );
  await p.goto(base + "/stock/AAPL?tab=business&view=highlights");
  const table = p.getByRole("region", { name: "Against its industry" });
  const margin = table.locator("[data-ratio=operatingMargin]");
  await margin.waitFor();
  const cells = await margin.locator(":scope > td").allInnerTexts();
  assert(cells[0] === "33%" && cells[1] === "14.3%", `value and the industry's median: ${cells.join(" | ")}`);
  await margin.getByText("Higher than 97%").waitFor();
  await margin.getByText("of 62 companies · SIC 35xx").waitFor();
  await margin.getByText("higher than 95% of its years").waitFor();
  await table.locator("[data-ratio=roic]").getByText("Not enough comparable companies with data yet.").waitFor();
  await table.locator("[data-ratio=debtToEquity]").getByText("History too short (under 5 years) to compare.").waitFor();
  await table.locator("[data-ratio=revenueGrowth]").getByText("Not enough data to calculate it.").waitFor();
  assert((await table.locator("[data-ratio=equityToAssets]").count()) === 0, "a ratio that doesn't apply has a row");
  assert((await p.locator("article").filter({ hasText: "Operating margin" }).count()) === 0, "the old cards are back");
  await axe(p);
  await margin.getByText("See history").click();
  await margin.getByRole("table").getByText("FY2024").waitFor();
  await p.getByText("What each metric means").click();
  await p.getByText("Don't apply to this type of company: Equity / assets.", { exact: false }).waitFor();
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

// ---- Comps -------------------------------------------------------------------------------------

await test("comps: peers without a price are named in one line, not empty rows; a value typed from another source joins the table as yours", async () => {
  const p = await page({ lang: "en" });
  const inputs = (rev) => ({ revenue: rev, revenuePrev: rev * 0.9, grossProfit: rev * 0.4, operatingIncome: rev * 0.2, netIncome: rev * 0.15, ocf: rev * 0.22, capex: rev * 0.04, equity: rev * 0.5, assets: rev * 1.2, longTermDebt: rev * 0.2, cash: rev * 0.1, depreciation: rev * 0.03 });
  const cap = (value, price) => ({ value, shares: value / price, sharesSource: "cover", sharesAsOf: "2026-10-20", price, priceAt: "2026-11-25T21:00:00Z" });
  const peer = (symbol, rev, mc) => ({ symbol, name: `${symbol} Inc.`, sic: 3571, marketCap: mc, marketCapBasis: mc ? cap(mc, 100) : null, inputs: inputs(rev) });
  await p.route(/\/api\/valuation\/comps/, (r) =>
    r.fulfill(json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      data: {
        year: 2025,
        target: { ...peer("AAPL", 400e9, 3.4e12), price: 230, businessType: "standard", sicDescription: "Electronic computers" },
        peers: [peer("DELL", 95e9, 80e9), peer("HPQ", 54e9, 30e9), peer("CSCO", 54e9, 230e9), peer("SMCI", 15e9, null), peer("ANET", 7e9, null)],
        suggested: true,
        unknown: [],
        marketCapsIssue: "plan_restricted",
        unpriced: ["SMCI", "ANET"],
      },
    })),
  );
  await p.goto(base + "/stock/AAPL?tab=valuation&view=comps");
  const table = p.getByRole("region", { name: "Comparable companies" });
  await table.getByText("DELL", { exact: true }).waitFor();
  assert((await table.getByText("SMCI", { exact: true }).count()) === 0, "an unpriced peer is still a table row");
  assert((await table.getByRole("spinbutton").count()) + (await table.getByRole("textbox").count()) === 0, "inputs left in the table");
  const box = p.getByTestId("comps-unpriced");
  await box.getByText("2 peers have no price today (SMCI, ANET)", { exact: false }).waitFor();
  await axe(p);
  await box.getByText("Type a market value from another source").click();
  await box.getByLabel("Market value of SMCI in billions of $").fill("25");
  await box.getByLabel("Market value of SMCI in billions of $").blur();
  await table.getByText("SMCI", { exact: true }).waitFor();
  await table.getByText("typed by you").waitFor();
  await box.getByText("1 peer has no price today (ANET)", { exact: false }).waitFor();
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

// ---- Filing reader ------------------------------------------------------------------------------

const report = (section, accn) => {
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
    filing: reports.find((r) => r.accn === accn) ?? reports[0], // the requested report, like the real endpoint
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
    r.fulfill(json({ ok: true, data: report(u.searchParams.get("s"), u.searchParams.get("accn")), fetchedAt: new Date().toISOString() }));
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
  // The older report is read before going back (going back at once could cancel the read).
  await until(() => asked.includes("mdna|0000320193-25-000079"), () => `requests: ${asked}`);
  await p.getByText("No encontramos esta sección en este informe", { exact: false }).waitFor();
  assert((await p.getByLabel("Informe", { exact: true }).inputValue()) === "0000320193-25-000079", "older report not selected");
  await p.goBack();
  await p.waitForURL((u) => !u.search.includes("accn"));
  // Back reads the latest report again; the picker follows once it's in.
  const picker = p.getByLabel("Informe", { exact: true });
  await until(async () => (await picker.inputValue()) === "0000320193-26-000026", async () => `back didn't return to the latest report (shows ${await picker.inputValue()})`);
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
  await p.goto(base + "/stock/AAPL");
  await p.locator(".tradingview-widget-container iframe").waitFor({ state: "attached" });
  const h = await p.locator(".tradingview-widget-container iframe").evaluate((f) => f.getBoundingClientRect().height);
  assert(h >= 400, `chart is ${h}px tall`);
  await p.context().close();
});

// ---- Account sync -------------------------------------------------------------------------------

/** A page that talks to the real (demo, in-memory) account store. */
async function syncedPage(opts) {
  const p = await page(opts);
  await p.route(/\/api\/prefs/, (r) => r.continue());
  return p;
}

await test("account sync: a followed list saved on one device appears on another, and edits travel both ways", async () => {
  // Device A: has stocks from before sync existed; its first sync uploads them.
  const a = await syncedPage({ watchlist: ["ZION", "AAPL"] });
  await a.goto(base + "/");
  await a.locator("[data-sync=synced]").waitFor();
  // Device B: a fresh browser with its own list: it gets A's stocks and keeps its own.
  const b = await syncedPage({ watchlist: ["KO"] });
  await b.goto(base + "/");
  await b.locator("[data-sync=synced]").waitFor();
  await b.getByTestId("company-ZION").waitFor();
  await b.getByTestId("company-KO").waitFor();
  // An edit on B (unfollowing ZION on its page) reaches A when A comes back.
  await b.goto(base + "/stock/ZION");
  await b.getByRole("button", { name: "Siguiendo" }).click();
  await b.getByText("Dejaste de seguir ZION.").waitFor();
  await b.waitForTimeout(1200); // the save waits a moment so quick edits make one request
  await b.goto(base + "/");
  await b.locator("[data-sync=synced]").waitFor();
  await a.reload();
  await a.locator("[data-sync=synced]").waitFor();
  await a.getByTestId("company-KO").waitFor();
  assert((await a.getByTestId("company-ZION").count()) === 0 || !(await a.getByTestId("company-ZION").getByText("Siguiendo").count()), "B's unfollow didn't reach A");
  await a.context().close();
  await b.context().close();
});

await test("account sync: when the account can't be reached, edits stay in this browser and it says so", async () => {
  const p = await page({ watchlist: ["AAPL"] });
  await p.route(/\/api\/prefs/, (r) => r.fulfill(json({ ok: false, error: "upstream" }, 502)));
  await p.goto(base + "/");
  await p.getByText("No pudimos guardar en tu cuenta. Se guarda en este navegador y lo reintentamos.").waitFor();
  await p.goto(base + "/stock/AAPL");
  await p.getByRole("button", { name: "Siguiendo" }).click();
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("iep.watchlist")));
  assert(Array.isArray(saved) && saved.length === 0, `kept locally: ${JSON.stringify(saved)}`);
  await p.context().close();
});

// ---- Chart packs, earnings date, methodology ------------------------------------------------

/** A company's SEC series for tests: steady growth, a seed per symbol so peers differ. */

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

await test("stock: tabs are history entries; keyboard Home/End; old tab links land on the new place", async () => {
  const p = await page();
  await p.goto(base + "/stock/AAPL");
  assert((await p.getByRole("tab").count()) === 5, "five tabs");
  await p.getByRole("tab", { name: "Finanzas", exact: true }).click();
  await p.waitForURL(/tab=business/);
  await p.getByRole("button", { name: "Resultados" }).click();
  await p.waitForURL(/view=income/);
  await p.goBack();
  await p.waitForURL((u) => u.search.includes("tab=business") && !u.search.includes("view="));
  await p.goBack();
  await p.waitForURL((u) => !u.search.includes("tab="));
  assert((await p.getByRole("tab", { name: "Resumen" }).getAttribute("aria-selected")) === "true", "Back didn't return to overview");
  await p.goForward();
  await p.waitForURL(/tab=business/);
  await p.getByRole("tab", { name: "Finanzas", exact: true }).focus();
  await p.keyboard.press("End");
  await p.waitForURL(/tab=research/);
  assert(await p.evaluate(() => document.activeElement?.id === "tab-research"), "End didn't move focus");
  await p.keyboard.press("Home");
  await p.waitForURL((u) => !u.search.includes("tab="));
  await p.waitForFunction(() => document.getElementById("tab-overview")?.getAttribute("aria-selected") === "true");
  // Links from before the merge land on the new place, without an extra history entry.
  await p.goto(base + "/stock/AAPL?tab=news");
  await p.waitForURL(/tab=filings&view=news/);
  assert((await p.getByRole("tab", { name: "Filings" }).getAttribute("aria-selected")) === "true", "old news link");
  await p.goto(base + "/stock/AAPL?tab=chart");
  await p.waitForURL((u) => !u.search.includes("tab="));
  await p.context().close();
});

await test("stock: unknown ticker is a real 404", async () => {
  const p = await page();
  const res = await p.goto(base + "/stock/1NOPE");
  assert(res.status() === 404, `status ${res.status()}`);
  await p.context().close();
});

// Six fiscal years shaped like the SEC statements API answers (lib/financials.ts).
function financialsPayload() {
  const years = [2020, 2021, 2022, 2023, 2024, 2025];
  const cell = (value, extra = {}) => ({ value, concept: "Test", accn: "0000000000-00-000000", ...extra });
  const rev = years.map((_, i) => 100e9 * 1.1 ** i);
  const line = (f) => years.map((_, i) => cell(f(i)));
  const annual = {
    periods: years.map((y) => ({ end: `${y}-09-30`, label: `FY${y}`, form: "10-K" })),
    lines: {
      revenue: line((i) => rev[i]),
      costOfRevenue: line((i) => rev[i] * 0.6),
      grossProfit: line((i) => rev[i] * 0.4),
      researchDevelopment: line((i) => rev[i] * 0.05),
      operatingIncome: line((i) => rev[i] * (0.2 + i * 0.01)),
      interestExpense: years.map((_, i) => cell(i < 4 ? 1e9 : null)),
      netIncome: line((i) => rev[i] * 0.15),
      epsDiluted: years.map((_, i) => cell(1 + i * 0.2, i < 2 ? { splitAdjusted: 4 } : {})),
      dilutedShares: years.map((_, i) => cell(16e9 - i * 0.2e9, i < 2 ? { splitAdjusted: 4 } : {})),
      cash: line(() => 30e9),
      totalAssets: line(() => 300e9),
      longTermDebt: line(() => 20e9),
      operatingCashFlow: line((i) => rev[i] * 0.25),
      capex: line(() => 5e9),
      freeCashFlow: line((i) => rev[i] * 0.25 - 5e9),
      buybacks: line(() => 10e9),
    },
  };
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    data: {
      symbol: "AAPL", cik: 320193, entityName: "Apple Inc.", fetchedAt: new Date().toISOString(), annual,
      quarterly: { periods: [], lines: {} },
      shares: { points: [], splits: [{ after: "2022-07-01", before: "2022-10-01", ratio: 4 }], reliableFrom: null },
    },
  };
}

await test("financials: highlights in words, statements in one unit, three readings, phone width", async () => {
  const p = await page();
  await p.route(/\/api\/sec\/financials\//, (r) => r.fulfill(json(financialsPayload())));
  // The overview shows the first three findings and opens the full view.
  await p.goto(base + "/stock/AAPL");
  const card = p.locator("#highlights-card");
  await card.getByText(/^Los ingresos crecieron un 10% al año/).waitFor();
  assert((await card.locator("li").count()) === 3, "three findings on the overview");
  await card.getByRole("button", { name: "Ver todo lo esencial" }).click();
  await p.waitForURL(/tab=business&view=highlights/);
  const fin = p.getByRole("tabpanel", { name: "Finanzas" });
  await fin.getByText(/^Los ingresos crecieron un 10% al año entre FY2020 y FY2025/).waitFor();
  await fin.getByText("Por cada dólar de beneficio generó $1.42 de flujo de caja libre en los últimos 5 años.").waitFor();
  await fin.getByText(/^Tiene más caja que deuda: caja neta de \$10B al cierre de FY2025\./).waitFor();
  await p.getByRole("button", { name: "Resultados" }).click();
  await p.waitForURL(/view=income/);
  await p.getByText("Cifras en miles de millones de dólares; negativos entre paréntesis.").waitFor();
  await p.getByText("No reportado desde FY2024").waitFor();
  await p.getByText("Acciones y BPA de años anteriores ajustados por el split 4:1 de 2022, para que los años se puedan comparar.").waitFor();
  const table = p.getByRole("region", { name: "Resultados · Anual" });
  assert((await table.getByRole("row", { name: /^Ingresos/ }).innerText()).includes("161.1"), "revenue in billions");
  await p.getByRole("button", { name: "% de ingresos" }).click();
  await p.getByText("Cada línea como porcentaje de los ingresos del mismo período.").waitFor();
  assert((await table.getByRole("row", { name: /^Costo de ventas/ }).innerText()).includes("60.0%"), "common size");
  await p.getByRole("button", { name: "Variación" }).click();
  assert((await table.getByRole("row", { name: /^Ingresos/ }).innerText()).includes("10.0%"), "growth");
  await axe(p);
  await p.getByRole("button", { name: "Flujo de caja" }).click();
  await p.waitForURL(/view=cashflow/);
  await p.getByRole("button", { name: "Valores" }).click();
  assert((await p.getByRole("region", { name: "Flujo de caja · Anual" }).getByRole("row", { name: /^Inversión en activos/ }).innerText()).includes("(5.0)"), "payments in parentheses");
  await p.context().close();

  const phone = await page({ width: 360, height: 780, touch: true });
  await phone.route(/\/api\/sec\/financials\//, (r) => r.fulfill(json(financialsPayload())));
  for (const view of ["highlights", "income"]) {
    await phone.goto(base + `/stock/AAPL?tab=business&view=${view}`);
    await phone.getByText(view === "income" ? "Cifras en miles de millones de dólares; negativos entre paréntesis." : /^Los ingresos crecieron/).waitFor();
    const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(over <= 0, `${view}: page overflows by ${over}px`);
  }
  await axe(phone);
  await phone.context().close();
});

await test("overview: Lo esencial says why when no source can answer", async () => {
  const p = await page();
  await p.goto(base + "/stock/AAPL"); // demo: no SEC database
  await p.locator("#highlights-card").getByText("La fuente de datos no está configurada.").waitFor();
  await p.context().close();
});

// ---- Data tabs (the shared resource state machine, lib/resource.ts) -----------------------------

await test("data tabs: an expired beta session asks to sign in again and comes back to the same tab", async () => {
  const p = await page();
  // The gate answers 401 without our envelope; before, most tabs showed an empty message.
  await p.route(/\/api\/sec\/(quality|ratios)\//, (r) => r.fulfill(json({ error: "beta_required" }, 401)));
  await p.goto(base + "/stock/AAPL?tab=business");
  await p.getByText("Tu acceso a la beta caducó. Vuelve a entrar para ver esta sección.").first().waitFor();
  const link = p.getByRole("link", { name: "Volver a entrar a la beta" }).first();
  const href = await link.getAttribute("href");
  assert(href === "/beta?next=%2Fstock%2FAAPL%3Ftab%3Dbusiness", `href ${href}`);
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
  await p.goto(base + "/stock/AAPL?tab=filings&view=insiders");
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
  await p.locator("#price").waitFor();
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
  const thesis = p.getByLabel("Thesis", { exact: true });
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
  await p.getByLabel("Thesis", { exact: true }).waitFor();
  assert((await p.getByLabel("Thesis", { exact: true }).inputValue()).startsWith("Pricing power"), "thesis not kept");
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

const verdictFixture = (symbol) => ({
  ok: true,
  fetchedAt: new Date().toISOString(),
  data: {
    symbol,
    points: [
      { key: "quality", level: "good", passed: 9, judged: 10 },
      { key: "growth", level: "mid", metric: "revenueGrowth", value: 0.05, compare: 0.05 },
      { key: "debt", level: "weak", metric: "debtToEquity", value: 1.8, compare: 0.9 },
    ],
    missing: [],
    fiscal: "FY2025",
    industry: "SOAP & DETERGENTS",
    priceAt: new Date().toISOString(),
    historyFrom: "2021-11-20",
    issues: {},
  },
});

await test("guided plan: reasons from the data, suggested levels with their reason, a position size, saved as a watched thesis", async () => {
  const p = await page({ lang: "en", planMode: null });
  await p.route("**/api/verdict/PG", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(verdictFixture("PG")) }));
  await p.goto(base + "/stock/PG?tab=research");
  await p.evaluate(() => fetch("/api/research/PG", { method: "DELETE" }));
  await p.reload();
  const guide = p.locator("#plan-builder");
  await guide.getByText("Step 1 of 3").waitFor();
  // Writing it by hand is remembered on this device, and the guide is one tap away.
  await guide.getByRole("button", { name: "I'd rather write it myself" }).click();
  await p.getByLabel("Thesis", { exact: true }).waitFor();
  await p.reload();
  await p.getByRole("button", { name: "Build my plan with help" }).click();
  await guide.getByText("Step 1 of 3").waitFor();
  await p.reload();
  await guide.getByText("Step 1 of 3").waitFor();

  // Step 1: a line from the data goes into the points with its figure and source; tapped again, it leaves.
  const quality = guide.getByRole("button", { name: /Passes the quality tests/ });
  await quality.click();
  const bull = guide.getByLabel("For (one per line)");
  assert(/\(9 of 10 tests passed · 10 years of annual reports; SEC, FY2025\)$/.test(await bull.inputValue()), `bull: ${await bull.inputValue()}`);
  assert((await quality.getAttribute("aria-pressed")) === "true", "chip not pressed");
  await quality.click();
  assert((await bull.inputValue()) === "", "line not removed");
  await quality.click();
  await guide.getByRole("button", { name: /More debt than most of its industry/ }).click();
  assert(/More debt/.test(await guide.getByLabel("Against (one per line)").inputValue()), "against line missing");
  await guide.getByLabel("Your thesis in one sentence").fill("Pricing power keeps margins up.");
  await axe(p);
  await guide.getByRole("button", { name: "Next" }).click();

  // Step 2: levels from the price history, each with its reason; a tap fills the field.
  await guide.getByRole("heading", { name: "What would change your mind?" }).waitFor();
  const lists = guide.getByRole("list", { name: "Suggestions" });
  // The price history is asked for only on this step: wait for its suggestions, not the review dates.
  await guide.getByRole("button", { name: /from the entry/ }).first().waitFor();
  const stop = lists.nth(0).getByRole("button").first();
  const stopText = await stop.innerText();
  assert(/from the entry/.test(stopText) && /(bounced|stalled|bad days|lowest price|highest price)/.test(stopText), `stop suggestion: ${stopText}`);
  await stop.click();
  const stopField = guide.getByLabel("Stop", { exact: true });
  await until(async () => (await stopField.inputValue()) !== "", "the stop suggestion didn't fill the field");
  const stopValue = Number(await stopField.inputValue());
  assert(stopValue > 0 && stopText.includes(stopValue.toFixed(2)), `stop field ${stopValue} vs ${stopText}`);
  await lists.nth(1).getByRole("button").first().click();
  await guide.getByRole("button", { name: /In 3 months/ }).click();
  await guide.getByTestId("plan-preview").getByText(/we'll tell you if the price falls to it/).waitFor();
  await axe(p);
  await guide.getByRole("button", { name: "Next" }).click();

  // Step 3: the size follows from the money, the % at risk and the distance to the stop.
  await guide.getByText(/Type the money you invest with/).waitFor();
  await guide.getByLabel("Money you invest with").fill("10000");
  const sizing = guide.getByTestId("sizing");
  await sizing.getByText(/^Size for your rule: [\d,.]+ shares? \(US\$ [\d,.]+\)\. If the price reaches your exit \(US\$ [\d,.]+\), you'd lose US\$ (99\.9\d|100\.00): 1% of your money\.$/).waitFor();
  await guide.getByRole("button", { name: "2%" }).click();
  await sizing.getByText(/you'd lose US\$ (199\.9\d|200\.00): 2% of your money|Your money covers/).waitFor();
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("iep.risk")));
  assert(saved.account === 10000 && saved.pct === 0.02, `risk settings ${JSON.stringify(saved)}`);
  await axe(p);
  await guide.getByRole("button", { name: "Next" }).click();

  // Review, save: a watched thesis, and the form from then on.
  const summary = guide.getByTestId("plan-summary");
  await summary.getByText("Pricing power keeps margins up.").waitFor();
  await summary.getByText(/Passes the quality tests/).waitFor();
  await guide.getByRole("button", { name: "Save and watch" }).click();
  await p.getByText("Done: your thesis is being watched.").waitFor();
  await p.locator("#thesis-status").getByText("On track").waitFor();
  assert(Number(await p.getByLabel("Stop", { exact: true }).inputValue()) === stopValue, "stop not saved");
  await p.reload();
  await p.getByRole("button", { name: "Redo the plan with help" }).waitFor();
  assert((await p.locator("#plan-builder").count()) === 0, "a planned notebook should open on the form");
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("phone alerts: turn on (saved with the language), send a test, turn off; a blocked browser and an iPhone outside the app are told what to do", async () => {
  const p = await page({ lang: "en" });
  // Headless Chromium has no push service: the browser's push and permission APIs are stood in for.
  await p.addInitScript(() => {
    let perm = sessionStorage.getItem("perm") || "default";
    Object.defineProperty(Notification, "permission", { get: () => perm, configurable: true });
    Notification.requestPermission = async () => (perm = window.__nextPermission || "granted");
    let current = null;
    PushManager.prototype.subscribe = async function (o) {
      current = {
        endpoint: "https://push.example.com/send/e2e",
        options: { applicationServerKey: new Uint8Array(o.applicationServerKey).buffer },
        toJSON() {
          return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } };
        },
        async unsubscribe() {
          current = null;
          return true;
        },
      };
      return current;
    };
    PushManager.prototype.getSubscription = async () => current;
  });
  await p.route("**/api/push/test", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, fetchedAt: new Date().toISOString(), data: { devices: 1, sent: 1 } }) }));
  // The channels show on the hub only once something is watched (a thesis with a fair value here).
  let notes = [];
  await p.route(/\/api\/research$/, (r) => r.fulfill(json({ ok: true, fetchedAt: "x", data: notes })));
  await p.route(/\/api\/trades$/, (r) => r.fulfill(json({ ok: true, fetchedAt: "x", data: [] }))); // the demo store outlives a run
  await p.goto(base + "/research");
  await p.getByRole("heading", { level: 1, name: "My research" }).waitFor();
  await p.getByRole("heading", { name: "How it works" }).waitFor();
  assert((await p.getByTestId("push-settings").count()) === 0, "alert channels offered with nothing watched");
  notes = [{ symbol: "KO", thesis: "Pricing power.", bull: "", bear: "", fairValue: 80, entry: null, stop: null, target: null, direction: "up", reviewBy: null, checks: [], opened: null, closed: null, log: [], updatedAt: "2026-11-20T00:00:00Z" }];
  await p.reload();
  const box = p.getByTestId("push-settings");
  const saved = p.waitForRequest((r) => r.url().endsWith("/api/push") && r.method() === "POST");
  await box.getByRole("button", { name: "Turn on alerts on this device" }).click();
  const body = (await saved).postDataJSON();
  assert(body.lang === "en" && body.subscription.endpoint === "https://push.example.com/send/e2e" && body.subscription.keys.auth, `saved ${JSON.stringify(body)}`);
  await box.getByText("On for this device.").waitFor();
  assert(await p.evaluate(async () => !!(await navigator.serviceWorker.getRegistration("/"))), "service worker not registered");
  await box.getByRole("button", { name: "Send a test alert" }).click();
  await box.getByText(/Sent: it should arrive/).waitFor();
  await axe(p);
  const removed = p.waitForRequest((r) => r.url().endsWith("/api/push") && r.method() === "DELETE");
  await box.getByRole("button", { name: "Turn off on this device" }).click();
  assert((await removed).postDataJSON().endpoint === "https://push.example.com/send/e2e", "wrong endpoint removed");
  // Blocked in the browser (refused at the prompt, or earlier): says how to allow it.
  await p.evaluate(() => sessionStorage.setItem("perm", "denied"));
  await p.reload();
  await box.getByText(/blocked in your browser/).waitFor();
  assert((await box.getByRole("button", { name: "Turn on alerts on this device" }).count()) === 0, "a blocked browser still offers the button");
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();

  // An iPhone in Safari (not added to the home screen) has no push: the page says how to get it.
  const ios = await page({ lang: "en", width: 390, height: 844, touch: true });
  await ios.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
    delete window.PushManager;
  });
  await ios.route(/\/api\/research$/, (r) => r.fulfill(json({ ok: true, fetchedAt: "x", data: notes })));
  await ios.goto(base + "/research");
  await ios.getByTestId("push-settings").getByText(/Add to Home Screen/).waitFor();
  await ios.context().close();
});

await test("installable app: the manifest, icons and service worker are served without the beta session", async () => {
  for (const [path, type] of [["/manifest.webmanifest", "manifest"], ["/sw.js", "javascript"], ["/icon-192.png", "image/png"], ["/apple-touch-icon.png", "image/png"]]) {
    const r = await fetch(base + path);
    assert(r.ok && (r.headers.get("content-type") ?? "").includes(type), `${path}: ${r.status} ${r.headers.get("content-type")}`);
  }
  const m = await (await fetch(base + "/manifest.webmanifest")).json();
  assert(m.display === "standalone" && m.icons.some((i) => i.sizes === "512x512"), "manifest incomplete");
});

await test("trades: log a buy and a sell on a thesis (an oversell is refused), see the position, delete in order", async () => {
  const p = await page({ lang: "en" });
  await p.goto(base + "/research");
  // The demo store outlives a run: start with no trades and a thesis on MU with a stop.
  const price = await p.evaluate(async () => {
    const all = await (await fetch("/api/trades")).json();
    for (const t of [...all.data].reverse()) await fetch(`/api/trades/${t.id}`, { method: "DELETE" });
    const q = await (await fetch("/api/quotes?symbols=MU")).json();
    const price = Math.round(q.quotes[0].price * 100) / 100;
    await fetch("/api/research/MU", { method: "DELETE" });
    await fetch("/api/research/MU", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ thesis: "Memory cycle turning.", stop: Math.round(price * 90) / 100, price, baseUpdatedAt: null }) });
    return price;
  });
  await p.goto(base + "/stock/MU?tab=research");
  const box = p.locator("#trades");
  await box.getByText("No open position in MU.").waitFor();
  await box.getByText(/Saved with your current stop/).waitFor();
  await box.getByLabel("Shares").fill("10");
  await box.getByRole("button", { name: "Log it" }).click();
  await box.getByText("Logged.").waitFor();
  await box.getByText(/Open position: 10 shares, average cost/).waitFor();
  // Selling more than was bought is refused.
  await box.getByRole("button", { name: "Sell" }).click();
  await box.getByLabel("Shares").fill("20");
  await box.getByRole("button", { name: "Log it" }).click();
  await box.getByText("You can't sell more shares than you held on that date.").waitFor();
  await box.getByLabel("Shares").fill("10");
  await box.getByLabel("Price").fill(String(Math.round(price * 110) / 100)); // +10 %
  await box.getByRole("button", { name: "Log it" }).click();
  await box.getByText("No open position in MU.").waitFor();
  // The buy can't go while the sell relies on it.
  await box.getByRole("button", { name: /Delete the trade of/ }).last().click();
  await box.getByText("A later sell relies on that buy: delete the sell first.").waitFor();
  await axe(p);

  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

// Trades with a split, a renamed and a delisted ticker go in through the API here.
await test("holdings on the hub: each held stock is a row, a split restated, a renamed and a delisted ticker flagged, the total with its source", async () => {
  const p = await page({ lang: "en", watchlist: [] });
  await p.goto(base + "/");
  await p.evaluate(async () => {
    const all = await (await fetch("/api/trades")).json();
    for (const t of [...all.data].reverse()) await fetch(`/api/trades/${t.id}`, { method: "DELETE" });
    for (const s of ["KO", "NEWCO", "OLDCO"]) await fetch(`/api/research/${s}`, { method: "DELETE" });
    const add = (symbol, date, shares, price) =>
      fetch("/api/trades", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, side: "buy", date, shares, price, fees: 0 }) });
    await add("KO", "2026-11-02", 10, 68);
    await add("SPLT", "2026-01-05", 2, 1000);
    await add("OLDCO", "2026-02-06", 3, 50);
    await add("GONE", "2026-02-07", 10, 5);
  });
  await p.reload();
  const list = p.getByTestId("companies");
  await list.getByTestId("holding-SPLT").getByText("20 shares · average cost US$ 100.00").waitFor(); // 2 at $1,000 before a 10-for-1 split
  await list.getByTestId("holding-GONE").getByText("No longer trades in the US.").waitFor();
  await list.getByTestId("holding-OLDCO").getByText("Now trades as NEWCO.").waitFor();
  await list.getByTestId("holding-KO").getByText(/No exit set/).waitFor();
  await list.getByTestId("company-KO").getByText("No thesis yet").waitFor();
  await p.getByTestId("holdings-total").getByText(/You hold 4 positions worth/).waitFor();
  assert((await p.getByText("To log what you own of a stock", { exact: false }).count()) === 0, "the how-to shows only with no holdings");
  await axe(p);
  // The renamed ticker: its row opens the research tab, where one tap moves the notebook, alerts and trades.
  await list.getByTestId("company-OLDCO").getByRole("link", { name: /OLDCO/ }).first().click();
  await p.waitForURL(/\/stock\/OLDCO\?tab=research/);
  await p.locator("#listing").getByRole("button", { name: "Move everything to NEWCO" }).click();
  await p.waitForURL(/\/stock\/NEWCO\?tab=research/);
  const symbols = await p.evaluate(async () => (await (await fetch("/api/trades")).json()).data.map((t) => t.symbol));
  assert(symbols.includes("NEWCO") && !symbols.includes("OLDCO"), `trades moved: ${symbols}`);
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("trading canvas: a template, linked windows, a note moved by keyboard and by drag, close and undo, maximize, saved across reloads; a sheet on phones", async () => {
  const p = await page({ lang: "en" });
  await p.route(/\/api\/search\?q=/, (r) => {
    const q = new URL(r.request().url()).searchParams.get("q").toUpperCase();
    r.fulfill(json([{ symbol: q, name: `${q} Corp.` }]));
  });
  await p.goto(base + "/canvas");
  await p.getByRole("heading", { level: 1, name: "Trading Canvas" }).waitFor();
  await axe(p);
  // Start: the company and a template.
  const start = p.getByRole("main");
  await searchInside(start, "MSFT");
  await p.getByTestId("start-symbol").getByText("MSFT").waitFor();
  await p.getByRole("radio", { name: /Technical desk/ }).click();
  await p.getByRole("button", { name: "Create canvas" }).click();
  await p.waitForURL(/\/canvas\?c=c-/);
  const windows = p.locator("[data-window]");
  await p.getByRole("button", { name: /Switch canvas: MSFT: Technical desk/ }).waitFor();
  assert((await windows.count()) === 5, `windows ${await windows.count()}`);
  // Linked windows follow one company.
  await windows.first().getByRole("button", { name: /Change this window's company: MSFT/ }).click();
  await searchInside(windows.first(), "NVDA");
  await p.waitForFunction(() => [...document.querySelectorAll("[data-window] button")].filter((b) => /company: NVDA$/.test(b.getAttribute("aria-label") ?? "")).length === 5);
  // A note, from the menu.
  await p.getByRole("button", { name: "Add window" }).click();
  await p.getByRole("dialog", { name: "Add a window" }).getByRole("button", { name: /^Note/ }).click();
  const note = p.locator("[data-window]").filter({ has: p.getByLabel("Note text") });
  await note.getByLabel("Note text").fill("Breakout above the 200-day average.");
  // Moved with the keyboard from its title…
  const left = async () => Number((await note.getAttribute("style")).match(/left: (-?\d+)px/)[1]);
  const x0 = await left();
  await note.getByRole("button", { name: /^Note\. Move the window/ }).focus();
  await p.keyboard.press("ArrowRight");
  await p.keyboard.press("ArrowRight");
  assert((await left()) === x0 + 16, `keyboard move ${x0} → ${await left()}`);
  // …and by dragging its title bar (the canvas zoom scales the distance).
  const handle = note.getByRole("button", { name: /^Note\. Move the window/ });
  const box = await handle.boundingBox();
  await p.mouse.move(box.x + 20, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 6 });
  await p.mouse.up();
  assert((await left()) > x0 + 60, `drag ${x0} → ${await left()}`);
  // Close and undo.
  await note.getByRole("button", { name: "Close window" }).click();
  await p.getByText("Window closed.").waitFor();
  assert((await windows.count()) === 5, "note not closed");
  await p.getByRole("button", { name: "Undo" }).click();
  await p.getByLabel("Note text").waitFor();
  // Maximize and back with Escape.
  await note.getByRole("button", { name: "Maximize" }).click();
  await note.getByRole("button", { name: "Restore" }).waitFor();
  await p.keyboard.press("Escape");
  await note.getByRole("button", { name: "Maximize" }).waitFor();
  // Zoom from the toolbar.
  await p.getByRole("button", { name: "Zoom in" }).click();
  await p.getByRole("button", { name: /Back to 100% \(\d+ %\)/ }).waitFor();
  await p.getByRole("button", { name: "Fit all" }).click();
  await axe(p);
  // Everything is still there after a reload.
  await p.waitForTimeout(700); // saved half a second after the last change
  await p.reload();
  await p.getByRole("button", { name: /Switch canvas: MSFT: Technical desk/ }).waitFor();
  assert((await p.locator("[data-window]").count()) === 6, "windows after reload");
  assert((await p.getByLabel("Note text").inputValue()) === "Breakout above the 200-day average.", "note text");
  assert((await p.locator("[data-window] button[aria-label$='company: NVDA']").count()) === 5, "linked symbol after reload");
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();

  // On a phone the add menu is a sheet and nothing scrolls sideways.
  const m = await page({ lang: "en", width: 390, height: 844, touch: true });
  await m.goto(base + "/canvas");
  await m.getByRole("button", { name: "Create canvas" }).click();
  await m.waitForURL(/\/canvas\?c=c-/);
  await m.getByRole("button", { name: "Add window" }).tap();
  const sheet = m.getByRole("dialog", { name: "Add a window" });
  await sheet.waitFor();
  const sb = await sheet.boundingBox();
  assert(sb.x <= 1 && Math.abs(sb.x + sb.width - 390) <= 1, `sheet ${JSON.stringify(sb)}`);
  assert((await m.evaluate(() => document.documentElement.scrollWidth)) <= 390, "horizontal scroll");
  await m.context().close();
});

/** Types in the search field inside `scope` and picks the first suggestion. */
async function searchInside(scope, text) {
  const box = scope.getByRole("combobox").first();
  await box.fill(text);
  await scope.page().getByRole("option", { name: new RegExp(text) }).first().click();
}

await test("stats: the admin funnel counts first-party events (here, the demo's local user)", async () => {
  const p = await page({ lang: "en" });
  // A visit is recorded on arrival (once per device and day).
  const recorded = p.waitForResponse((r) => r.url().endsWith("/api/events") && r.request().method() === "POST");
  await p.goto(base + "/");
  await recorded;
  await p.goto(base + "/stats");
  await p.getByRole("heading", { name: "How IEP is used" }).waitFor();
  const funnelBox = p.getByTestId("stats-funnel");
  await funnelBox.getByText("Came in").waitFor();
  await funnelBox.getByText("Added what they own").waitFor();
  await axe(p);
  await p.context().close();
});

await test("research notebook: an edit from an outdated tab is refused, not silently overwritten", async () => {
  const a = await page({ lang: "en" });
  const b = await a.context().newPage();
  for (const p of [a, b]) {
    await p.goto(base + "/stock/PEP?tab=research");
    await p.getByLabel("Thesis", { exact: true }).waitFor();
  }
  const run = Date.now(); // the demo store lives as long as the server: make this run's text unique
  await b.getByLabel("Thesis", { exact: true }).fill(`Written in tab B ${run}`);
  await b.getByRole("button", { name: "Save" }).click();
  await b.getByText(/^Saved ·/).waitFor();
  await a.getByLabel("Thesis", { exact: true }).fill(`Written in tab A ${run}`);
  await a.getByRole("button", { name: "Save" }).click();
  await a.getByText(/changed on another device/).waitFor();
  assert((await a.getByLabel("Thesis", { exact: true }).inputValue()) === `Written in tab A ${run}`, "draft lost");
  await a.getByRole("button", { name: "Reload" }).waitFor();
  await a.context().close();
});

await test("live thesis: a stop and a condition raise alerts in the tab, on the home page and in the list; closing and reopening are recorded", async () => {
  const p = await page({ lang: "en", watchlist: ["JPM"] });
  await p.goto(base + "/stock/JPM?tab=research");
  // The demo store outlives a run: start from an empty notebook.
  await p.evaluate(() => fetch("/api/research/JPM", { method: "DELETE" }));
  await p.reload();
  await p.getByRole("heading", { name: "Your plan and alerts" }).waitFor();
  assert((await p.locator("#thesis-status").count()) === 0, "an empty status box is shown before there's anything to watch");
  await p.getByLabel("Stop").fill("250"); // the demo price is $240: the stop is already hit
  // Before saving, the plan says what each level will do, and warns about a stop above the price.
  const preview = p.getByTestId("plan-preview");
  await preview.getByText(/Your stop is above the price: if you expect a rise, it counts as hit right away/).waitFor();
  await p.getByLabel("Fair value", { exact: true }).fill("200");
  await preview.getByText(/Fair value \$200\.00 · 16\.7% below the price: we'll tell you if the price falls to it/).waitFor();
  await p.getByLabel("Fair value", { exact: true }).fill("");
  await p.getByRole("button", { name: "Add condition" }).click();
  await p.getByLabel("Tell me if…").selectOption("move");
  await p.getByLabel("A move of at least").fill("0.05");
  await p.getByRole("button", { name: "Add condition" }).last().click();
  await p.getByRole("button", { name: "Add condition" }).click();
  await p.getByLabel("The price", { exact: true }).selectOption("above");
  await p.getByLabel("Level").fill("1000");
  await p.getByRole("button", { name: "Add condition" }).last().click();
  await p.getByText("The price rises above $1,000.00").waitFor();
  await p.getByRole("button", { name: "Save" }).click();
  const status = p.locator("#thesis-status");
  await status.getByText("Hit your stop of $250.00 (price $240.00)").waitFor();
  await status.getByText("At risk").waitFor();
  await status.getByText(/Moved \+0\.1% in a day \(your alert: ±0\.05%\)/).waitFor();
  assert((await status.getByText(/Rose above/).count()) === 0, "a condition that isn't true raised an alert");
  await p.getByRole("heading", { name: "Thesis history" }).waitFor();
  await p.getByText(/Started being watched · price \$240\.00/).waitFor();
  await axe(p);
  // Removing a condition and saving keeps the rest.
  await p.getByRole("button", { name: "Remove condition: The price rises above $1,000.00" }).click();
  await p.getByRole("button", { name: "Save" }).click();
  await p.getByText(/^Saved ·/).waitFor();
  await p.reload();
  await status.getByText("Hit your stop of $250.00 (price $240.00)").waitFor();
  assert((await p.getByText("The price rises above $1,000.00").count()) === 0, "removed condition came back");
  // The home briefing and the list page show it.
  await p.goto(base + "/");
  const theses = p.locator("#theses");
  await theses.getByText("Hit your stop of $250.00 (price $240.00)").waitFor();
  await theses.getByRole("link", { name: /JPM/ }).first().waitFor();
  // Marking an alert as seen takes it off the home page; it stays on the thesis.
  await theses.getByRole("button", { name: /^Mark as seen: JPM: Hit your stop/ }).click();
  await theses.getByText("Hit your stop of $250.00 (price $240.00)").waitFor({ state: "detached" });
  await theses.getByText(/One alert you've seen stays in "My research"/).waitFor();
  await p.goto(base + "/stock/JPM?tab=research");
  await status.getByText(/Hit your stop of \$250\.00 \(price \$240\.00\).*· Seen/).waitFor();
  await status.getByText("At risk").waitFor(); // seen, but still true
  await p.goto(base + "/research");
  await p.getByRole("link", { name: /JPM/ }).getByText("At risk").waitFor();
  // Close it with an outcome and a lesson, then reopen it.
  await p.goto(base + "/stock/JPM?tab=research");
  await status.getByRole("button", { name: "Close thesis" }).click();
  await status.getByRole("button", { name: "Partly" }).click();
  await status.getByLabel("What I learned (optional)").fill("Sized too big.");
  await status.locator("form").getByRole("button", { name: "Close thesis" }).click();
  await p.getByText(/^Closed on .*: Partly\.$/).waitFor();
  await p.getByText("Sized too big.").waitFor();
  await p.getByText(/Closed: Partly · price \$240\.00/).waitFor();
  assert((await p.getByText(/^No longer true/).count()) === 0, "closing listed its alerts as no longer true");
  await p.goto(base + "/research");
  await p.getByRole("link", { name: /JPM/ }).getByText("Closed").waitFor();
  await p.goto(base + "/stock/JPM?tab=research");
  await p.getByRole("button", { name: "Reopen thesis" }).click();
  await status.getByText("At risk").waitFor();
  await p.getByText("Reopened · price $240.00").waitFor();
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("live thesis: when the check fails, the home page says so and offers a retry", async () => {
  const p = await page({ lang: "en", watchlist: ["JPM"] });
  await p.route(/\/api\/research$/, (r) => r.fulfill(json({ ok: true, fetchedAt: "2026-11-20T15:00:00Z", data: [{ symbol: "JPM", thesis: "", bull: "", bear: "", fairValue: null, entry: null, stop: 1, target: null, direction: "up", reviewBy: null, checks: [], opened: null, closed: null, log: [], updatedAt: "2026-11-20T10:00:00Z" }] })));
  await p.route(/\/api\/theses$/, (r) => r.fulfill(json({ ok: false, error: "upstream" }, 502)));
  await p.goto(base + "/");
  await p.locator("#theses").getByRole("button", { name: /Try again|Retry/ }).waitFor();
  await p.context().close();
});

// ---- Calendar (SEC summaries and notebooks answered with fixtures) ----------------------------

// ---- AI explanation (its endpoint answered with fixtures: no Claude calls in tests) ------------

const explainFacts = [
  { id: "F1", label: "Revenue · Q4 FY2026", value: "$102.5B (+8% vs Q4 FY2025)", source: "10-K filed on 2026-10-31", href: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000105/" },
  { id: "F2", label: "Quality tests (Buffett) passed", value: "9 of 10 (good)", source: "10-K FY2025" },
  { id: "F3", label: "Today's multiple against its 5-year average", value: "34.2x / 27.1x (weak)", source: "price from Financial Modeling Prep and SEC figures" },
];
const explainBase = { symbol: "AAPL", lang: "en", facts: explainFacts, explanation: null, generatedAt: null, model: null, canGenerate: true };

await test("AI explanation: written on request, every sentence links to the facts it cites; off and empty states are plain", async () => {
  const p = await page({ lang: "en" });
  let posts = 0;
  await p.route(/\/api\/explain\/AAPL/, (r) => {
    if (r.request().method() === "POST") {
      posts++;
      return r.fulfill(json({ ok: true, fetchedAt: "2026-11-20T15:00:00Z", data: { ...explainBase, generatedAt: "2026-11-20T15:00:00Z", model: "claude-opus-5-5", explanation: {
        quarter: [{ text: "Revenue grew 8% from a year earlier.", facts: ["F1"] }],
        bull: [{ text: "It passes 9 of the 10 quality tests.", facts: ["F2"] }],
        bear: [{ text: "Its earnings multiple is above its 5-year average.", facts: ["F3"] }],
      } } }));
    }
    r.fulfill(json({ ok: true, fetchedAt: "2026-11-20T15:00:00Z", data: explainBase }));
  });
  await p.goto(base + "/stock/AAPL");
  const panel = p.locator("#explain");
  await panel.getByText("There's no explanation yet for the latest figures.").waitFor();
  await panel.getByRole("button", { name: "Write the explanation" }).click();
  await panel.getByRole("heading", { name: "What happened last quarter" }).waitFor();
  await panel.getByText("Revenue grew 8% from a year earlier.").waitFor();
  assert(posts === 1, `posts: ${posts}`);
  // The citation opens the fact, with its source linked to the SEC filing.
  await panel.getByRole("link", { name: "Fact 1: Revenue · Q4 FY2026" }).click();
  await p.waitForURL(/#fact-F1$/);
  await panel.locator("#fact-F1").getByRole("link", { name: /10-K filed on 2026-10-31/ }).waitFor();
  await panel.getByText(/Written by Claude \(claude-opus-5-5\)/).waitFor();
  await panel.getByText(/AI can be wrong: check each figure at its source\. Not a recommendation\./).waitFor();
  await axe(p);
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();

  // Not turned on here: no panel at all, rather than one that says it's off.
  const off = await page({ lang: "es" });
  await off.route(/\/api\/explain\/AAPL/, (r) => r.fulfill(json({ ok: true, fetchedAt: "2026-11-20T15:00:00Z", data: { ...explainBase, lang: "es", canGenerate: false, why: "not_configured" } })));
  const asked = off.waitForResponse((r) => /\/api\/explain\/AAPL/.test(r.url()));
  await off.goto(base + "/stock/AAPL");
  await asked;
  await off.getByRole("heading", { name: "Último trimestre" }).waitFor();
  assert((await off.locator("#explain").count()) === 0, "panel shown while the feature is off");
  await off.context().close();

  // Too many requests: the writing fails plainly and can be tried later.
  const busy = await page({ lang: "en" });
  await busy.route(/\/api\/explain\/AAPL/, (r) => (r.request().method() === "POST" ? r.fulfill(json({ ok: false, error: "rate_limited" }, 429)) : r.fulfill(json({ ok: true, fetchedAt: "x", data: explainBase }))));
  await busy.goto(base + "/stock/AAPL");
  await busy.locator("#explain").getByRole("button", { name: "Write the explanation" }).click();
  await busy.locator("#explain").getByText(/You asked for several explanations in a row/).waitFor();
  await busy.context().close();
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
  // The detailed filters wait behind one button, so the results are close to the top.
  const more = p.getByRole("button", { name: /^Más filtros/ });
  assert(!(await p.locator("#screener-more").isVisible()), "detailed filters open before asking");
  await more.click();
  await p.locator("#screener-more").getByText("Sector").first().waitFor();
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

// ---- Journeys in both languages and themes ------------------------------------------------

for (const [lang, theme] of [["es", "light"], ["en", "dark"]]) {
  await test(`journey (${lang}, ${theme}): search → stock → follow → your companies, accessible on the way`, async () => {
    const p = await page({ lang, theme, width: 390, height: 844, touch: true });
    await p.goto(base + "/");
    await axe(p);
    const box = searchBox(p);
    await box.fill("apple");
    await p.getByRole("option").first().waitFor();
    await box.press("Enter");
    await p.waitForURL(/\/stock\//);
    await p.getByRole("heading", { level: 1 }).waitFor();
    await p.getByRole("heading", { name: lang === "es" ? "Lo esencial" : "Highlights" }).first().waitFor();
    await axe(p);
    const symbol = p.url().split("/stock/")[1];
    await p.getByRole("button", { name: lang === "es" ? "Seguir" : "Follow", exact: true }).tap();
    // Followed stocks are in your companies, on the home page (first in the bottom bar).
    await p.getByRole("navigation", { name: lang === "es" ? "Navegación principal" : "Main navigation" }).last().getByRole("link", { name: lang === "es" ? "Mi análisis" : "Research" }).tap();
    await p.waitForURL((u) => u.pathname === "/");
    await p.getByTestId(`company-${symbol}`).waitFor();
    await axe(p);
    assert(p.errors.length === 0, p.errors.join(" | "));
    await p.context().close();
  });
}

await test("language switch loads the other dictionary and keeps the page working", async () => {
  const p = await page();
  await p.goto(base + "/stock/AAPL");
  await p.getByRole("heading", { name: "Lo esencial" }).first().waitFor();
  await p.getByRole("button", { name: /^ES,/ }).click();
  await p.getByRole("heading", { name: "Highlights" }).first().waitFor();
  assert((await p.evaluate(() => document.documentElement.lang)) === "en", "html lang not updated");
  await p.reload();
  await p.getByRole("heading", { name: "Highlights" }).first().waitFor(); // remembered (cookie)
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
  await searchBox(p).waitFor();
  await p.getByText("$").first().waitFor({ timeout: 30_000 });
  await p.context().close();
});

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
