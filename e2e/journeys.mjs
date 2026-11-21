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
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return; // ONLY="live thesis" runs the matching journeys
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
async function page({ width = 1280, height = 900, lang = "es", theme = "light", watchlist = [], touch = false, onboarding = false, planMode = "form" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, locale: lang === "es" ? "es-US" : "en-US" });
  await ctx.addCookies([{ name: "lang", value: lang, url: base }]);
  await ctx.addInitScript(
    ([theme, list, onboarding, planMode]) => {
      if (!sessionStorage.getItem("seeded")) {
        // An empty notebook opens on the guided plan; journeys use the form unless they test the guide.
        if (planMode) localStorage.setItem("iep.planMode", planMode);
        localStorage.setItem("iep.theme", theme);
        localStorage.setItem("iep.watchlist", JSON.stringify(list));
        // The getting-started checklist is hidden except in its own journey.
        if (!onboarding) localStorage.setItem("iep.onboarding", JSON.stringify({ hidden: true }));
        localStorage.setItem("iep.chartView", "simple");
        sessionStorage.setItem("seeded", "1");
      }
    },
    [theme, watchlist, onboarding, planMode],
  );
  await ctx.route(/tradingview\.com/, (r) => r.abort());
  await ctx.route(/\/api\/prefs/, (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not_configured" }) }));
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
  await p.getByRole("option", { name: /MSFT · DCF/ }).waitFor();
  await axe(p);
  await p.keyboard.press("Enter");
  await p.waitForURL(/\/stock\/MSFT\?tab=valuation&view=dcf$/);
  await p.getByRole("button", { name: "DCF", pressed: true }).waitFor();
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

await test("getting started: four steps tick themselves off as you use the app, and the list can be hidden", async () => {
  const p = await page({ lang: "en", onboarding: true });
  await p.route(/\/api\/research$/, (r) => r.fulfill(json({ ok: true, fetchedAt: "x", data: [] })));
  await p.goto(base + "/");
  const box = p.locator("#getting-started");
  await box.getByText("0 of 4 done").waitFor();
  await axe(p);
  // Trying the commands ticks that step.
  await box.getByRole("button", { name: "Open commands" }).click();
  await p.getByRole("dialog", { name: "Commands" }).waitFor();
  await p.keyboard.press("Escape");
  await box.getByText("1 of 4 done").waitFor();
  await box.getByText("Try the commands (Done)").waitFor();
  // Comparing two companies ticks another.
  await box.getByRole("link", { name: "Compare" }).click();
  await p.waitForURL(/\/compare\?s=AAPL,MSFT$/);
  await p.getByRole("heading", { name: "Compare: AAPL · MSFT" }).waitFor();
  await p.waitForFunction(() => JSON.parse(localStorage.getItem("iep.onboarding") ?? "{}").compare === true);
  await p.goto(base + "/");
  await box.getByText("2 of 4 done").waitFor();
  // Following a stock: the home page becomes the briefing, with the checklist still there.
  await p.evaluate(() => localStorage.setItem("iep.watchlist", JSON.stringify(["KO"])));
  await p.reload();
  await box.getByText("3 of 4 done").waitFor();
  await box.getByRole("link", { name: "Write my thesis" }).waitFor();
  assert((await box.getByRole("link", { name: "Write my thesis" }).getAttribute("href")) === "/stock/KO?tab=research", "thesis step opens the followed stock");
  await box.getByRole("button", { name: "Hide" }).click();
  await box.waitFor({ state: "detached" });
  await p.reload();
  await p.getByRole("heading", { level: 1 }).first().waitFor();
  assert((await p.locator("#getting-started").count()) === 0, "hidden checklist came back");
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("navigation: Explore lists every tool with what it's for; on phones it's a sheet that also opens the commands", async () => {
  const p = await page({ lang: "en" });
  await p.goto(base + "/");
  const nav = p.getByRole("navigation", { name: /main/i }).first();
  await nav.getByRole("button", { name: "Explore" }).click();
  await p.getByRole("link", { name: /Compare\s*Up to four companies side by side/ }).waitFor();
  await axe(p);
  await p.getByRole("link", { name: /Calendar\s*Results, deadlines/ }).click();
  await p.waitForURL(/\/calendar$/);
  await p.context().close();

  const m = await page({ lang: "es", width: 390, height: 800, touch: true });
  await m.goto(base + "/");
  await m.getByRole("button", { name: "Explorar" }).click();
  const sheet = m.getByRole("dialog", { name: "Explorar" });
  await sheet.getByRole("link", { name: /Buscador/ }).waitFor();
  await sheet.getByRole("button", { name: "Comandos y atajos" }).click();
  await m.getByRole("dialog", { name: "Comandos" }).waitFor();
  await m.context().close();
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
  // No notebooks: fair values would add their own quotes (the demo store outlives a run).
  await p.route(/\/api\/research$/, (r) => r.fulfill(json({ ok: true, fetchedAt: "x", data: [] })));
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
  await p.getByTestId("watch-card").first().waitFor(); // phones get cards, not the table
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(over <= 0, `page overflows by ${over}px`);
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
  await p.getByRole("button", { name: "TradingView", exact: true }).click();
  await p.locator(".tradingview-widget-container iframe").waitFor({ state: "attached" });
  const h = await p.locator(".tradingview-widget-container iframe").evaluate((f) => f.getBoundingClientRect().height);
  assert(h >= 400, `chart is ${h}px tall`);
  await p.context().close();
});

// ---- Home briefing ------------------------------------------------------------------------------

await test("home briefing: following stocks shows what changed, each row opening its place; empty lists say so", async () => {
  const p = await page({ watchlist: ["AAPL", "MSFT", "KO"] });
  await p.route(/\/api\/research$/, (r) => r.fulfill(json({ ok: true, fetchedAt: "x", data: [] }))); // the demo store outlives a run
  const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const snap = (symbol, o) => ({
    symbol, cik: 320193,
    quality: { ok: false, error: "not_found" },
    filings: { ok: true, data: { report: null, latest: null, recent: o.recent ?? [], nextResults: o.next ? { date: o.next, basedOn: day(-355) } : null } },
    insiders: { ok: true, data: { from: "", to: "", bought: o.bought ?? 0, sold: o.sold ?? 0, buyers: 1, sellers: 0, pending: 0, checkedAt: "" } },
  });
  const data = {
    AAPL: snap("AAPL", { recent: [{ accn: "0000320193-26-000099", form: "10-K", filed: day(-2), reportDate: null, primaryDocument: "a.htm", items: [] }], next: day(5) }),
    MSFT: snap("MSFT", { bought: 2.5e6, sold: 1e6 }),
    KO: snap("KO", { recent: [0, 1, 2].map((i) => ({ accn: `ko-${i}`, form: "DEFA14A", filed: day(-i), reportDate: null, primaryDocument: "a.htm", items: [] })) }),
  };
  await p.route(/\/api\/sec\/snapshot\//, (r) => r.fulfill(json({ ok: true, data: data[decodeURIComponent(r.request().url().split("/snapshot/")[1])], fetchedAt: new Date().toISOString() })));
  await p.goto(base + "/");
  await p.getByRole("heading", { level: 1, name: /^(Buenos días|Buenas tardes|Buenas noches)$/ }).waitFor();
  await p.getByText("Lo nuevo de las acciones que sigues (3).", { exact: false }).waitFor();
  const filing = p.getByRole("link", { name: /AAPL\s*Anuales \(10-K\)/ });
  await filing.waitFor();
  assert((await filing.getAttribute("href")) === "/stock/AAPL/report?accn=0000320193-26-000099", "10-K opens the reader");
  await p.getByRole("link", { name: /AAPL\s*hacia el/ }).waitFor();
  // Three proxy supplements are one row, in plain words, opening the stock's filings.
  const proxy = p.getByRole("link", { name: /KO\s*Junta de accionistas · DEFA14A\s*3 presentaciones/ });
  assert((await proxy.getAttribute("href")) === "/stock/KO?tab=filings", "grouped filings open the filings tab");
  const ins = p.getByRole("link", { name: /MSFT\s*Compras \$2\.5M/ });
  assert((await ins.getAttribute("href")) === "/stock/MSFT?tab=filings&view=insiders", "insiders link");
  // Empty lists fold into one line; with no fair values yet it says how to add one.
  await p.getByTestId("brief-quiet").getByText(/Sin novedades en: frente a tu valor justo/).waitFor();
  await p.getByText("Pon un valor razonable en «Mi análisis»", { exact: false }).waitFor();
  assert((await p.getByRole("heading", { name: "Frente a tu valor justo" }).count()) === 0, "an empty list still has its own box");
  assert((await p.getByRole("heading", { name: "Explorar otras empresas" }).count()) === 1, "explore moved down");
  await axe(p);
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();
});

await test("home briefing: SEC data that can't load is said once, the rest still shows", async () => {
  const p = await page({ watchlist: ["AAPL", "MSFT"] }); // demo: the SEC summaries answer "not configured"
  await p.goto(base + "/");
  await p.getByText("No pudimos revisar 2 de 2 acciones (sin fuente de datos).").waitFor();
  await p.getByTestId("brief-quiet").getByText(/nuevas presentaciones/).waitFor();
  await p.locator("#mini-watchlist").getByText("AAPL").first().waitFor();
  await p.context().close();
});

// ---- Account sync -------------------------------------------------------------------------------

/** A page that talks to the real (demo, in-memory) account store. */
async function syncedPage(opts) {
  const p = await page(opts);
  await p.route(/\/api\/prefs/, (r) => r.continue());
  return p;
}

await test("account sync: a list saved on one device appears on another, and edits travel both ways", async () => {
  const tag = `Sync${Date.now() % 100000}`;
  // Device A: has stocks and a tag from before sync existed; its first sync uploads them.
  const a = await syncedPage({ watchlist: ["ZION", "AAPL"] });
  await a.addInitScript((t) => {
    if (!sessionStorage.getItem("tagged")) {
      localStorage.setItem("iep.watchtags", JSON.stringify({ ZION: [t] }));
      sessionStorage.setItem("tagged", "1");
    }
  }, tag);
  await a.goto(base + "/watchlist");
  await a.locator("[data-sync=synced]").waitFor();
  // Device B: a fresh browser with its own list: it gets A's stocks and tag, and keeps its own.
  const b = await syncedPage({ watchlist: ["KO"] });
  await b.goto(base + "/watchlist");
  await b.locator("[data-sync=synced]").waitFor();
  await b.locator("main tbody th a[href='/stock/ZION']").waitFor();
  await b.locator("main tbody th a[href='/stock/KO']").waitFor();
  await b.getByRole("group", { name: "Filtrar por etiqueta" }).getByRole("button", { name: new RegExp(tag) }).waitFor();
  // An edit on B reaches A when A comes back to the page.
  await b.getByRole("button", { name: "Quitar ZION de la lista" }).click();
  await b.locator("[data-sync=synced]").waitFor();
  await b.waitForTimeout(1200); // the save waits a moment so quick edits make one request
  await a.reload();
  await a.locator("[data-sync=synced]").waitFor();
  await a.waitForFunction(() => !document.querySelector("main tbody th a[href='/stock/ZION']"));
  assert((await a.locator("main tbody th a[href='/stock/KO']").count()) === 1, "B's stock didn't reach A");
  await a.context().close();
  await b.context().close();
});

await test("account sync: when the account can't be reached, edits stay in this browser and it says so", async () => {
  const p = await page({ watchlist: ["AAPL"] });
  await p.route(/\/api\/prefs/, (r) => r.fulfill(json({ ok: false, error: "upstream" }, 502)));
  await p.goto(base + "/watchlist");
  await p.getByText("No pudimos guardar en tu cuenta. Se guarda en este navegador y lo reintentamos.").waitFor();
  await p.getByRole("button", { name: "Quitar AAPL de la lista" }).click();
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("iep.watchlist")));
  assert(Array.isArray(saved) && saved.length === 0, `kept locally: ${JSON.stringify(saved)}`);
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
  await p.locator("main svg").first().waitFor(); // the chart is drawn: the page's scripts are running
  await p.getByRole("button", { name: "Mediana de pares" }).click();
  await p.waitForURL(/p=1/);
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
  assert((await p.getByRole("tab").count()) === 5, "five tabs");
  await p.getByRole("tab", { name: "Negocio", exact: true }).click();
  await p.waitForURL(/tab=business/);
  await p.getByRole("button", { name: "Estados financieros" }).click();
  await p.waitForURL(/view=statements/);
  await p.goBack();
  await p.waitForURL((u) => u.search.includes("tab=business") && !u.search.includes("view="));
  await p.goBack();
  await p.waitForURL((u) => !u.search.includes("tab="));
  assert((await p.getByRole("tab", { name: "Resumen" }).getAttribute("aria-selected")) === "true", "Back didn't return to overview");
  await p.goForward();
  await p.waitForURL(/tab=business/);
  await p.getByRole("tab", { name: "Negocio", exact: true }).focus();
  await p.keyboard.press("End");
  await p.waitForURL(/tab=research/);
  assert(await p.evaluate(() => document.activeElement?.id === "tab-research"), "End didn't move focus");
  await p.keyboard.press("Home");
  await p.waitForURL((u) => !u.search.includes("tab="));
  await p.waitForFunction(() => document.getElementById("tab-overview")?.getAttribute("aria-selected") === "true");
  const overview = p.locator("#panel-overview");
  await overview.getByRole("button", { name: "6M" }).click();
  await p.waitForURL(/range=6M/);
  await overview.getByRole("button", { name: /^Indicadores/ }).click();
  await overview.getByRole("checkbox", { name: /^RSI/ }).click();
  await p.waitForURL(/ind=sma%2Crsi%2Cvolume|ind=sma,rsi,volume/);
  await p.reload();
  assert((await p.locator("#panel-overview").getByRole("button", { name: "6M" }).getAttribute("aria-pressed")) === "true", "range lost on reload");
  // Links from before the merge land on the new place, without an extra history entry.
  await p.goto(base + "/stock/AAPL?tab=news");
  await p.waitForURL(/tab=filings&view=news/);
  assert((await p.getByRole("tab", { name: "Filings" }).getAttribute("aria-selected")) === "true", "old news link");
  await p.goto(base + "/stock/AAPL?tab=chart");
  await p.waitForURL((u) => !u.search.includes("tab="));
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
  await ov.getByRole("button", { name: /^Indicadores/ }).click();
  for (let i = 0; i < 3; i++) {
    await ov.getByRole("button", { name: "Línea" }).click();
    await ov.getByRole("button", { name: "Velas" }).click();
    await ov.getByRole("checkbox", { name: /^Bandas de Bollinger/ }).click();
    await ov.getByRole("checkbox", { name: /^Bandas de Bollinger/ }).click();
    await p.getByRole("button", { name: /Tema/ }).click();
  }
  await p.waitForTimeout(500);
  const after = await count();
  assert(after === before, `canvases ${before} → ${after}`);
  await ov.getByRole("checkbox", { name: /^MACD/ }).click();
  await p.waitForFunction((n) => document.querySelectorAll("#panel-overview canvas").length > n, before);
  const withPane = await panesOf();
  await ov.getByRole("checkbox", { name: /^MACD/ }).click();
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
  await p.goto(base + "/stock/AAPL?tab=business");
  const card = p.locator("article", { hasText: "Beneficio neto" });
  await card.waitFor();
  assert((await card.locator(".bg-down").count()) === 1, "one bar below zero");
  assert((await card.locator(".bg-series-1").count()) === 2, "two bars above zero");
  await card.getByText("Ver los datos").click();
  const cells = await card.locator("tbody td").allInnerTexts();
  assert(cells.some((c) => c.startsWith("−$")) && cells.includes("—"), `cells ${cells.join(",")}`);
  await p.context().close();
});

await test("at a glance: five lines from SEC figures, each opening its tab; gaps said plainly", async () => {
  const p = await page();
  const answer = { ok: true, fetchedAt: new Date().toISOString(), data: { symbol: "AAPL", fiscal: "FY2026", industry: "Electronic Computers", priceAt: new Date().toISOString(), historyFrom: "2021-11-30", issues: {}, missing: ["growth"], points: [
    { key: "quality", level: "good", passed: 7, judged: 8 },
    { key: "profitability", level: "good", metric: "roic", value: 0.52, compare: 0.11, peers: 41 },
    { key: "debt", level: "weak", metric: "debtToEquity", value: 1.45, compare: 0.42, peers: 41 },
    { key: "valuation", level: "weak", metric: "pe", value: 35.2, compare: 28.4 },
  ] } };
  await p.route(/\/api\/verdict\//, (r) => r.fulfill(json(answer)));
  await p.goto(base + "/stock/AAPL");
  const card = p.locator("#glance");
  await card.getByText("Un negocio de alta calidad según las pruebas de Buffett").waitFor();
  await card.getByText("ROIC 52% · mediana de la industria 11%").waitFor();
  await card.getByText("PER 35.2x · media de 5 años 28.4x").waitFor();
  await card.getByText("Sin datos suficientes para: crecimiento.").waitFor();
  await card.getByRole("button", { name: /Cotiza por encima de su media de 5 años/ }).click();
  await p.waitForURL(/tab=valuation/);
  await p.goBack();
  await p.locator("#glance").getByRole("button", { name: /Más deuda que la mayoría/ }).click();
  await p.waitForURL(/tab=business/);
  await p.goBack();
  await axe(p);
  await p.context().close();
});

await test("at a glance: when no source can answer, the card says why", async () => {
  const p = await page();
  await p.goto(base + "/stock/AAPL"); // demo: no SEC database
  await p.locator("#glance").getByText("La fuente de datos no está configurada.").waitFor();
  await p.context().close();
});

// ---- Data tabs (the shared resource state machine, lib/resource.ts) -----------------------------

await test("data tabs: an expired beta session asks to sign in again and comes back to the same tab", async () => {
  const p = await page();
  // The gate answers 401 without our envelope; before, most tabs showed an empty message.
  await p.route(/\/api\/(sec\/(quality|ratios)|analysts)\//, (r) => r.fulfill(json({ error: "beta_required" }, 401)));
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
  const quality = guide.getByRole("button", { name: /A high-quality business/ });
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
  await lists.first().getByRole("button").first().waitFor();
  const stop = lists.nth(0).getByRole("button").first();
  const stopText = await stop.innerText();
  assert(/from the entry/.test(stopText) && /(support|ATR|52-week)/.test(stopText), `stop suggestion: ${stopText}`);
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
  await sizing.getByText(/To lose no more than \$100\.00 \(1% of \$10,000\.00\): \d+ shares/).waitFor();
  await guide.getByRole("button", { name: "2%" }).click();
  await sizing.getByText(/\$200\.00 \(2% of \$10,000\.00\)|Your money covers/).waitFor();
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("iep.risk")));
  assert(saved.account === 10000 && saved.pct === 0.02, `risk settings ${JSON.stringify(saved)}`);
  await axe(p);
  await guide.getByRole("button", { name: "Next" }).click();

  // Review, save: a watched thesis, and the form from then on.
  const summary = guide.getByTestId("plan-summary");
  await summary.getByText("Pricing power keeps margins up.").waitFor();
  await summary.getByText(/A high-quality business/).waitFor();
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
  await p.goto(base + "/research");
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

await test("calendar: results, SEC deadlines and review dates by week; range, filters and .ics download", async () => {
  const p = await page({ lang: "en", watchlist: ["AAPL", "MSFT"] });
  const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const filing = (form, reportDate) => ({ accn: `${form}-${reportDate}`, form, filed: reportDate, reportDate, primaryDocument: "a.htm", items: [] });
  const snap = (symbol, f) => ({ symbol, cik: 1, quality: { ok: false, error: "not_found" }, insiders: { ok: false, error: "not_found" }, filings: { ok: true, data: { report: null, annual: null, latest: null, recent: [], nextResults: null, ...f } } });
  const data = {
    AAPL: snap("AAPL", { nextResults: { date: day(10), basedOn: day(-355) } }),
    MSFT: snap("MSFT", { report: filing("10-Q", day(-60)), annual: filing("10-K", day(-240)) }), // next 10-Q due in ~71 days
  };
  await p.route(/\/api\/sec\/snapshot\//, (r) => r.fulfill(json({ ok: true, data: data[decodeURIComponent(r.request().url().split("/snapshot/")[1])], fetchedAt: new Date().toISOString() })));
  await p.route(/\/api\/research$/, (r) => r.fulfill(json({ ok: true, fetchedAt: "x", data: [{ symbol: "KO", thesis: "", bull: "", bear: "", fairValue: null, entry: null, stop: null, target: null, direction: "up", reviewBy: day(20), checks: [], opened: null, closed: null, log: [], updatedAt: "2026-11-01T00:00:00Z" }] })));
  await p.route(/\/api\/theses/, (r) => r.fulfill(json({ ok: true, fetchedAt: "x", data: { items: [], skipped: 0 } })));
  await p.goto(base + "/calendar");
  await p.getByRole("heading", { name: "Calendar", level: 1 }).waitFor();
  await p.getByRole("link", { name: /AAPL.*Results \(estimated\)/ }).waitFor();
  await p.getByRole("link", { name: /KO.*Review your thesis/ }).waitFor();
  assert((await p.getByText("10-Q due").count()) === 0, "a deadline beyond 60 days is shown");
  await p.getByRole("button", { name: "90 days" }).click();
  await p.getByRole("link", { name: /MSFT.*10-Q due/ }).waitFor();
  await axe(p);
  // Hide results; the download has what's on screen.
  await p.getByRole("button", { name: "Results" }).click();
  await p.getByRole("link", { name: /AAPL.*Results/ }).waitFor({ state: "detached" });
  const [download] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Add to my calendar (.ics)" }).click()]);
  const ics = readFileSync(await download.path(), "utf8");
  assert(ics.includes("SUMMARY:KO: review thesis") && ics.includes("SUMMARY:MSFT: 10-Q due") && !ics.includes("AAPL"), ics);
  // The home briefing links here.
  await p.goto(base + "/");
  await p.getByRole("link", { name: "See calendar" }).click();
  await p.waitForURL(/\/calendar$/);
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();

  const empty = await page({ lang: "es" });
  await empty.route(/\/api\/research$/, (r) => r.fulfill(json({ ok: true, fetchedAt: "x", data: [] })));
  await empty.goto(base + "/calendar");
  await empty.getByText("Sigue acciones o pon una fecha de revisión en «Mi análisis» para ver aquí sus fechas.").waitFor();
  await empty.context().close();
});

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

  // Not turned on: it says so, with no button.
  const off = await page({ lang: "es" });
  await off.route(/\/api\/explain\/AAPL/, (r) => r.fulfill(json({ ok: true, fetchedAt: "2026-11-20T15:00:00Z", data: { ...explainBase, lang: "es", canGenerate: false, why: "not_configured" } })));
  await off.goto(base + "/stock/AAPL");
  await off.locator("#explain").getByText("Las explicaciones con IA aún no están activadas en este sitio.").waitFor();
  assert((await off.locator("#explain").getByRole("button").count()) === 0, "button shown while off");
  await off.context().close();

  // Too many requests: the writing fails plainly and can be tried later.
  const busy = await page({ lang: "en" });
  await busy.route(/\/api\/explain\/AAPL/, (r) => (r.request().method() === "POST" ? r.fulfill(json({ ok: false, error: "rate_limited" }, 429)) : r.fulfill(json({ ok: true, fetchedAt: "x", data: explainBase }))));
  await busy.goto(base + "/stock/AAPL");
  await busy.locator("#explain").getByRole("button", { name: "Write the explanation" }).click();
  await busy.locator("#explain").getByText(/You asked for several explanations in a row/).waitFor();
  await busy.context().close();
});

// ---- Compare (SEC and price endpoints answered with fixtures) ---------------------------------

const verdictFix = (sym, growth) => ({ ok: true, fetchedAt: "2026-11-20T15:00:00Z", data: { symbol: sym, points: [
  { key: "quality", level: "good", passed: 9, judged: 10 },
  { key: "growth", level: growth, metric: "revenueGrowth", value: growth === "good" ? 0.15 : 0.04, compare: 0.06, peers: 40 },
  { key: "profitability", level: "good", metric: "roic", value: 0.31, compare: 0.12 },
  { key: "debt", level: "mid", metric: "debtToEquity", value: 0.6, compare: 0.6 },
  { key: "valuation", level: "weak", metric: "pe", value: 34, compare: 27 },
], missing: [], fiscal: "FY2025", industry: "SOFTWARE", priceAt: "2026-11-20T15:00:00Z", historyFrom: "2021-11-30", issues: {} } });
const ratioRow = (key, better, value, percentile) => ({ key, group: "profitability", better, applicable: true, value, note: null, history: [], own: null, sector: { percentile, median: 0.1, n: 40, sicPrefix: "737" } });
const ratiosFix = (sym, roic, debt) => ({ ok: true, fetchedAt: "2026-11-20T15:00:00Z", data: { symbol: sym, cik: 1, businessType: "general", sic: 7372, sicDescription: "SOFTWARE", period: { label: "FY2025", end: "2025-09-30" }, peersYear: 2025, ratios: [
  ratioRow("revenueGrowth", "higher", 0.08, 60), ratioRow("roic", "higher", roic, roic > 0.3 ? 92 : 70), ratioRow("debtToEquity", "lower", debt, 40),
] } });
const valFix = (sym, pe) => ({ ok: true, fetchedAt: "2026-11-20T15:00:00Z", data: { symbol: sym, multiples: [{ key: "pe", applicable: true, higherIsCheaper: false, value: pe, note: null, own: { mean: 25 } }, { key: "fcfYield", applicable: false, higherIsCheaper: true, value: null, note: null, own: null }] } });
const months = Array.from({ length: 24 }, (_, i) => `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
const marketFix = (sym, start, step) => ({ ok: true, fetchedAt: "2026-11-20T15:00:00Z", data: { symbol: sym, multiples: "ok", monthly: { keys: months, ends: months.map((m) => `${m}-28`), values: { price: months.map((_, i) => start + i * step) } } } });

await test("compare: companies side by side from the URL, add and remove, phone table scrolls inside its box", async () => {
  const p = await page({ lang: "en" });
  await p.route(/\/api\/verdict\/(AAPL|MSFT|KO)/, (r) => { const s = r.request().url().split("/").pop(); r.fulfill(json(verdictFix(s, s === "MSFT" ? "good" : "mid"))); });
  await p.route(/\/api\/sec\/ratios\/(AAPL|MSFT|KO)/, (r) => { const s = r.request().url().split("/").pop(); r.fulfill(json(ratiosFix(s, s === "AAPL" ? 0.52 : 0.28, s === "AAPL" ? 1.5 : 0.4))); });
  await p.route(/\/api\/valuation\/(AAPL|MSFT|KO)/, (r) => { const s = r.request().url().split("/").pop(); r.fulfill(json(valFix(s, s === "AAPL" ? 33.4 : 30))); });
  await p.route(/\/api\/charts\/market\/(AAPL|MSFT|KO)/, (r) => { const s = r.request().url().split("/").pop(); r.fulfill(json(marketFix(s, 100, s === "AAPL" ? 2 : 1))); });
  await p.goto(base + "/compare?s=aapl,msft");
  await p.getByRole("heading", { name: "Compare: AAPL · MSFT" }).waitFor();
  const glance = p.getByRole("region", { name: "At a glance" });
  await glance.getByText("ROIC 31% · industry median 12%").first().waitFor();
  const ratios = p.getByRole("region", { name: "Against its industry" });
  await ratios.getByText("above 92% of its industry").waitFor();
  // Higher ROIC is better (AAPL); lower debt is better (MSFT): the best in each row is marked.
  const roic = ratios.getByRole("row", { name: /ROIC/ });
  await roic.getByText("best in the group").waitFor();
  assert((await roic.getByRole("cell").nth(0).innerText()).includes("52.0%") || (await roic.getByRole("cell").nth(0).innerText()).includes("52%"), "AAPL ROIC");
  const debtRow = ratios.getByRole("row", { name: /Debt/ });
  assert((await debtRow.getByRole("cell").nth(1).innerText()).includes("●"), "lower debt not marked as best");
  await p.getByRole("region", { name: "Valuation" }).getByText("33.4x").waitFor();
  await p.getByRole("region", { name: "Valuation" }).getByText("Not applicable").first().waitFor();
  await p.getByRole("group", { name: /Price performance: AAPL, MSFT/ }).waitFor();
  await axe(p);
  // Add a third company with the search, remove one: the URL follows.
  await p.route(/\/api\/search/, (r) => r.fulfill(json([{ symbol: "KO", name: "The Coca-Cola Company" }])));
  await p.getByRole("combobox", { name: "Add a company" }).fill("coca");
  await p.getByRole("option", { name: /KO/ }).click();
  await p.waitForURL(/s=AAPL,MSFT,KO$/);
  await p.getByRole("button", { name: "Remove MSFT from the comparison" }).click();
  await p.waitForURL(/s=AAPL,KO$/);
  await p.getByRole("heading", { name: "Compare: AAPL · KO" }).waitFor();
  // The stock page links here.
  await p.goto(base + "/stock/AAPL");
  await p.getByRole("link", { name: "Compare" }).click();
  await p.waitForURL(/\/compare\?s=AAPL$/);
  await p.getByText("Add at least one more company to compare.").waitFor();
  assert(p.errors.length === 0, p.errors.join(" | "));
  await p.context().close();

  const m = await page({ lang: "es", width: 320, height: 700 });
  await m.route(/\/api\/(verdict|sec\/ratios|valuation|charts\/market)\//, (r) => r.fulfill(json({ ok: false, error: "upstream" }, 502)));
  await m.goto(base + "/compare?s=AAPL,MSFT,GOOGL,NVDA");
  await m.getByRole("heading", { name: "Comparar: AAPL · MSFT · GOOGL · NVDA" }).waitFor();
  await m.getByText("Puedes comparar hasta 4 empresas.").waitFor();
  await m.waitForTimeout(500);
  assert((await m.evaluate(() => document.documentElement.scrollWidth)) <= 320, "page scrolls sideways at 320 px");
  await m.context().close();
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
    await p.getByRole("heading", { name: lang === "es" ? "De un vistazo" : "At a glance" }).waitFor();
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
  await p.getByRole("heading", { name: "De un vistazo" }).waitFor();
  await p.getByRole("button", { name: /^ES,/ }).click();
  await p.getByRole("heading", { name: "At a glance" }).waitFor();
  assert((await p.evaluate(() => document.documentElement.lang)) === "en", "html lang not updated");
  await p.reload();
  await p.getByRole("heading", { name: "At a glance" }).waitFor(); // remembered (cookie)
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
