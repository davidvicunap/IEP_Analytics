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
| `npm run e2e` | User journeys with network fixtures: search races, failures, keyboard/touch selection and shortcuts; watchlist paging past 30 symbols, partial failures, stale values, expired beta session, undo; tabs and chart state in the URL (Back/Forward), chart cleanup, accessible chart data, 404 for unknown tickers, signed bars for negative values; full journeys in es/light and en/dark with axe. |
| `npm run e2e:audit` | Every main screen at 320, 390, 768, 1024, 1440 px, mobile landscape and 200 % zoom, in both languages and themes: horizontal overflow, axe-core (WCAG 2.2 AA + best practices), touch targets under 44 px. Screenshots with `--shots`. |
| `npm run e2e:measure` | Lab performance: TTFB, FCP, LCP, CLS, time to the first price, JS and total bytes, requests. Mobile = 390 px, 4× CPU, 150 ms RTT / 1.6 Mbps; desktop = 1440 px, no throttling; cold cache; median of runs. |
| `npm run e2e:interactions` | Lab interaction latency (Event Timing API) for chart controls, theme and tabs on a 4×-throttled phone. |

Measurement knobs (demo data only, never real data):

- `DEMO_LATENCY_MS=300` adds simulated provider latency per call;
- `DEMO_SLOW_SYMBOLS=IWM,TSLA DEMO_SLOW_MS=1200` makes some quotes slow (tail latency);
- `IEP_TRACE=1` logs every data-facade call, to count provider calls per journey.
