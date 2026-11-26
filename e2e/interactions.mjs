// Lab interaction latency (Event Timing API: input → next paint), mobile profile with 4× CPU
// slowdown. Reports the slowest event per interaction, median of 5 repetitions.
// Usage: node e2e/interactions.mjs <baseUrl>
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.argv[2] ?? "http://localhost:3123";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "es-US" });
await ctx.addInitScript(() => {
  window.__ev = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.interactionId) window.__ev.push(e.duration);
  }).observe({ type: "event", buffered: true, durationThreshold: 16 });
});
await ctx.route(/tradingview/, (r) => r.abort());
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await p.goto(base + "/stock/AAPL", { waitUntil: "load" });
await p.getByRole("heading", { level: 1 }).first().waitFor();
await p.waitForTimeout(1500);
const measure = async (name, act) => {
  const xs = [];
  for (let i = 0; i < 5; i++) {
    await p.evaluate(() => (window.__ev = []));
    await act(i);
    await p.waitForTimeout(400);
    xs.push(Math.max(0, ...(await p.evaluate(() => window.__ev))));
  }
  xs.sort((a, b) => a - b);
  console.log(`${name.padEnd(28)} median ${Math.round(xs[2])} ms  max ${Math.round(xs[4])} ms`);
};
const btn = (re) => p.getByRole("button", { name: re }).first();
await p.getByTestId("studies-menu").tap();
await measure("saved indicator (RSI)", () => p.getByRole("checkbox", { name: "RSI", exact: true }).tap());
await p.keyboard.press("Escape");
await measure("theme toggle", () => btn(/Tema|Theme/).tap());
await measure("tab switch (Finanzas/Resumen)", (i) => p.getByRole("tab", { name: i % 2 ? /^Resumen$|^Overview$/ : /^Finanzas$|^Financials$/ }).tap());
await measure("view switch (Resultados/Balance)", (i) => btn(i % 2 ? /^Balance$/ : /^Resultados$|^Income$/).tap());
await b.close();
