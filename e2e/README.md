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
| `npm run e2e` | User journeys with network fixtures: search races, failures, keyboard/touch selection and shortcuts; watchlist paging past 30 symbols, partial failures, stale values, expired beta session, undo; tabs and chart state in the URL (Back/Forward), chart cleanup, accessible chart data, 404 for unknown tickers, signed bars for negative values; data tabs (expired session asks to sign in again, retry in place); stocks FMP can't price still open (no price, last close, stored price); research notebook (save, header fair value, dated notes, list page, two-tab conflict); calendar (results, SEC deadlines and review dates by week, range and kind filters, .ics download, empty state, briefing link); AI explanation (endpoint stubbed, never Claude: written on request, citations open their facts and SEC links, off and rate-limited states); compare (companies from the URL in four tables and a performance chart, best value per row, add with search and remove, stock page link, 320 px without sideways scroll); getting started (steps tick themselves off, hidden for good; hidden in every other journey); navigation (Explore menu with every tool on desktop, a sheet with commands on phones); command palette (Ctrl+K to a stock section in either word order, section alone uses the stock on screen, follow, theme, pages, Escape, no-match hint, axe); live thesis (an alert marked as seen leaves the home page and stays on the thesis; the plan previews each level and warns about a stop already hit; a stop and conditions raise alerts in the tab, home briefing and list; removing a condition; closing with an outcome and lesson, reopening; a failed check offers a retry); screener (detailed filters behind one button on phones; quick screens, filters and sorting in the request, saved screens, phone layout); quarter in review (changes, report and earnings-release links); watchlist dashboard (cards on phones; SEC columns per row, sorting with gaps last, failed rows retried, tags and columns remembered, phone width); filing reader (sections and filing in the URL, risk changes flagged, only-changed filter, missing section, retry); TradingView chart keeps its height after its script resizes the container; account sync (a list and tag saved on one device appear on another, edits travel both ways; an unreachable account keeps edits locally and says so; sync is off in other journeys because the demo store is shared); home briefing (filings grouped by stock and form in plain words, empty lists folded into one line; filings, results, fair value and insider lists with their links; empty lists; SEC data that can't load); stock page tabs (five tabs, views in the URL, old tab links rewritten); at a glance (five lines, each opening its tab, gaps said plainly, error state); chart packs (built-in pack for any company with growth readouts and peer median, save from the generator, reorder, remove, delete with undo, phone width); next earnings date (listed, estimated, unknown); methodology page (footer link, contents, both languages); chart generator (URL state, legend, keyboard readout, CSV, per-company errors, phone layout, no invented prices in demo); full journeys in es/light and en/dark with axe. |
| `npm run e2e:audit` | Every main screen at 320, 390, 768, 1024, 1440 px, mobile landscape and 200 % zoom, in both languages and themes: horizontal overflow, axe-core (WCAG 2.2 AA + best practices), touch targets under 44 px. Screenshots with `--shots`. |
| `npm run e2e:measure` | Lab performance: TTFB, FCP, LCP, CLS, time to the first price, JS and total bytes, requests. Mobile = 390 px, 4× CPU, 150 ms RTT / 1.6 Mbps; desktop = 1440 px, no throttling; cold cache; median of runs. |
| `npm run e2e:interactions` | Lab interaction latency (Event Timing API) for saved chart indicators, theme, tabs and statement views on a 4×-throttled phone. |

Measurement knobs (demo data only, never real data):

- `DEMO_LATENCY_MS=300` adds simulated provider latency per call;
- `DEMO_SLOW_SYMBOLS=IWM,TSLA DEMO_SLOW_MS=1200` makes some quotes slow (tail latency);
- `IEP_TRACE=1` logs every data-facade call, to count provider calls per journey.
- `DEMO_PRICE_FALLBACK=HIMS:none,SMCI:close,AMD:stored` makes those demo symbols behave as if FMP refused their quote (set by `npm run start:demo`).
