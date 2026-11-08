// Lab performance measurement of a local production build (`next start`).
// Usage: node e2e/measure.mjs <baseUrl> <out.json> [runs]
// Mobile profile: 390×844 CSS px, 4× CPU slowdown, 150 ms RTT / 1.6 Mbps down / 750 kbps up
// (Lighthouse's "Slow 4G" values). Desktop: 1440×900, no throttling. Every run uses a fresh
// browser context (cold HTTP cache). Reports the median of the runs.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const base = process.argv[2] ?? "http://localhost:3123";
const out = process.argv[3] ?? "measure.json";
const RUNS = Number(process.argv[4] ?? 3);

const WATCHLIST = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "V", "KO"];
const PROFILES = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, cpu: 4, net: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 } },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, cpu: 1, net: null },
};
// "Useful" = the first real price on screen (a $ amount inside main content).
const PAGES = [
  { name: "home", path: "/" },
  { name: "stock", path: "/stock/AAPL" },
  { name: "watchlist", path: "/watchlist" },
];

const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

async function runOnce(browser, profile, page) {
  const p = PROFILES[profile];
  const ctx = await browser.newContext({ viewport: p.viewport, deviceScaleFactor: p.deviceScaleFactor, isMobile: p.isMobile, hasTouch: p.hasTouch, locale: "es-US" });
  await ctx.addInitScript((list) => {
    try {
      localStorage.setItem("iep.watchlist", JSON.stringify(list));
    } catch {}
    window.__vitals = { lcp: 0, cls: 0, useful: null };
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__vitals.lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
    const check = () => {
      if (window.__vitals.useful != null) return;
      const main = document.querySelector("main");
      if (main && /\$\s?\d/.test(main.innerText || "")) window.__vitals.useful = performance.now();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, WATCHLIST);
  const tab = await ctx.newPage();
  const cdp = await ctx.newCDPSession(tab);
  await cdp.send("Network.enable");
  if (p.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: p.cpu });
  if (p.net) await cdp.send("Network.emulateNetworkConditions", { offline: false, ...p.net });
  const types = new Map();
  const bytes = { script: 0, total: 0 };
  const api = [];
  let requests = 0;
  cdp.on("Network.requestWillBeSent", (e) => {
    requests++;
    const u = new URL(e.request.url);
    if (u.pathname.startsWith("/api/")) api.push(u.pathname + u.search);
  });
  cdp.on("Network.responseReceived", (e) => types.set(e.requestId, e.type));
  cdp.on("Network.loadingFinished", (e) => {
    bytes.total += e.encodedDataLength;
    if (types.get(e.requestId) === "Script") bytes.script += e.encodedDataLength;
  });
  const t0 = Date.now();
  await tab.goto(base + page.path, { waitUntil: "load", timeout: 60_000 });
  const loadMs = Date.now() - t0;
  await tab.waitForTimeout(3000); // let streaming, hydration and client fetches settle
  const v = await tab.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return { ...window.__vitals, ttfb: nav?.responseStart ?? null, fcp: fcp?.startTime ?? null, dcl: nav?.domContentLoadedEventEnd ?? null };
  });
  await ctx.close();
  return { ...v, loadMs, requests, apiRequests: api.length, api, jsKB: bytes.script / 1024, totalKB: bytes.total / 1024 };
}

const browser = await chromium.launch();
const results = {};
for (const profile of Object.keys(PROFILES)) {
  for (const page of PAGES) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await runOnce(browser, profile, page));
    const m = (k) => median(runs.map((r) => r[k]));
    results[`${profile}:${page.name}`] = {
      ttfb: m("ttfb"), fcp: m("fcp"), lcp: m("lcp"), useful: m("useful"), cls: m("cls"), dcl: m("dcl"),
      jsKB: m("jsKB"), totalKB: m("totalKB"), requests: m("requests"), apiRequests: m("apiRequests"), api: runs[0].api,
    };
    const r = results[`${profile}:${page.name}`];
    console.log(`${profile.padEnd(7)} ${page.name.padEnd(9)} ttfb ${Math.round(r.ttfb)} fcp ${Math.round(r.fcp)} lcp ${Math.round(r.lcp)} useful ${r.useful == null ? "—" : Math.round(r.useful)} cls ${r.cls.toFixed(3)} js ${r.jsKB.toFixed(0)}KB total ${r.totalKB.toFixed(0)}KB req ${r.requests} api ${r.apiRequests}`);
  }
}
await browser.close();
writeFileSync(out, JSON.stringify(results, null, 2));
