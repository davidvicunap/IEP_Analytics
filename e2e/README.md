# Browser checks

Run against a **local production build in demo mode**: deterministic data, no provider
quota, no database writes (the build's `db-setup` step does nothing without `DATABASE_URL`).
They use the Playwright and Chromium installed on the machine (`require("playwright")`).

```bash
env -u DATABASE_URL -u FMP_API_KEY npm run build
npm run start:demo            # http://localhost:3123
```

| Script | What it checks |
|---|---|
| `npm run e2e` | User journeys with network fixtures (about 55): search (races, failures, keyboard and touch, phone header); stock page (five tabs and views in the URL, old links rewritten, thesis-first header, Lo esencial, financial statements, quarter in review, next earnings date, stocks FMP can't price still open, 404 for unknown tickers); data tabs (an expired session asks to sign in again, retry in place); your companies on the hub (theses, holdings and followed stocks in one list, quote pages of at most 30, missing prices and expired sessions said plainly, next event per row, follow and undo, /watchlist and /portfolio redirect, 320 px); holdings (splits restated, renamed and delisted tickers flagged); research notebook, guided plan (levels from the price history, saved as a watched thesis), trades, live thesis (alerts, conditions, closing and reopening, retry); phone alerts (turn on, test, off; blocked browser; iPhone outside the app; shown only once something is watched); chart indicators (one menu, saved, same in the canvas); trading canvas (templates, linked windows, keyboard and drag, undo, maximize, phone sheet); screener; filing reader; command palette; AI explanation (endpoint stubbed, never Claude; hidden when off); account sync (a list saved on one device appears on another; an unreachable account keeps edits locally); stats; methodology; navigation; installable app; slow network skeletons; full journeys in es/light and en/dark with axe. |
| `npm run e2e:audit` | Every main screen at 320, 390, 768, 1024, 1440 px, mobile landscape and 200 % zoom, in both languages and themes: horizontal overflow, axe-core (WCAG 2.2 AA + best practices), touch targets under 44 px. Screenshots with `--shots`. |
| `npm run e2e:measure` | Lab performance: TTFB, FCP, LCP, CLS, time to the first price, JS and total bytes, requests. Mobile = 390 px, 4× CPU, 150 ms RTT / 1.6 Mbps; desktop = 1440 px, no throttling; cold cache; median of runs. |
| `npm run e2e:interactions` | Lab interaction latency (Event Timing API) for saved chart indicators, theme, tabs and statement views on a 4×-throttled phone. |

Measurement knobs (demo data only, never real data):

- `DEMO_LATENCY_MS=300` adds simulated provider latency per call;
- `DEMO_SLOW_SYMBOLS=IWM,TSLA DEMO_SLOW_MS=1200` makes some quotes slow (tail latency);
- `IEP_TRACE=1` logs every data-facade call, to count provider calls per journey.
- `DEMO_PRICE_FALLBACK=HIMS:none,SMCI:close,AMD:stored` makes those demo symbols behave as if FMP refused their quote (set by `npm run start:demo`).
