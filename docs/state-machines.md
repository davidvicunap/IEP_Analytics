# State machines

Every piece of state in IEP Analytics that moves through distinct phases, where it lives, and how it is tested. Read this before adding a data view, a background job or anything that waits on the network.

**Rule:** a view never invents its own loading/error flags. It uses one of the machines below, so every screen fails, retries and recovers the same way.

## The one to reuse: remote resource

`src/lib/resource.ts` (pure) + `src/lib/useResource.ts` (React). One read of one of our JSON APIs.

```
            start                     settle(ok)
  (mount) ────────▶ loading ──────────────────────▶ ok ──┐ settle(ok), background pass
                      ▲   │ settle(error)                 │ (state stays ok; a failed pass
                      │   ▼                               │  keeps the data and stops)
       retry / new URL└── error                    ◀──────┘
```

- **States:** `loading { previous }`, `ok { data, fetchedAt }`, `error { issue }`.
  - `previous` keeps the last data on screen while a new URL loads, when the view asks for `keepPrevious`.
- **Issues** (`ViewIssue`): every `DataIssue` plus `beta_expired`.
  - **`beta_expired`** is the beta gate's bare 401. `IssueNote` turns it into "sign in again" with a link back to the same tab.
  - **`upstream` and `rate_limited`** are the only retryable issues. `IssueNote` shows "Try again" for them when given `onRetry`.
- **Reading responses** (`toViewResult`):
  - Our `Result` envelope is trusted whatever the status.
  - A bare 401 means `beta_expired`, because data routes never answer 401 themselves.
  - A bare 429 means `rate_limited`.
  - Anything unreadable becomes `upstream`. Never cast to `DataIssue`.
- **Requests:**
  - Each new URL or `retry()` aborts the previous request, so an older answer can't overwrite a newer one.
  - `shared: true` makes one request per URL for every view. Successes are kept; failures are dropped so the next view asks again.
- **Background passes:** `again(data)` plus `maxPasses` re-read in the background, as insiders do while filings are pending. The timer is cleared on unmount.
- **Used by:**
  - Stock tabs: Ratios, Insiders, Valuation, Comps (`keepPrevious`), Financial statements, Fundamentals (quality and analysts).
  - Filings, shared across four views: the Filings tab, Financials, News and the overview releases. The Filings tab keeps the current list while older filings load.
  - The chart generator's per-company loader (`sharedLoader`).
  - The watchlist dashboard's SEC summary per row (`sharedLoader`, at most 3 at once) and the filing reader's sections (`keepPrevious`).
- **Tests:**
  - `src/lib/resource.test.ts`: transitions, response reading, shared loader.
  - `e2e/journeys.mjs` "data tabs…": an expired session asks to sign in again; a retry asks again in place.

### Adding a data view

```tsx
const { state, retry } = useResource<MyPayload>(`/api/thing/${encodeURIComponent(symbol)}`);
if (state.status === "loading") return <Skeleton />;
if (state.status === "error") return <IssueNote issue={state.issue} onRetry={retry} />;
return <View data={state.data} asOf={state.fetchedAt} />;
```

The route returns `Result<T>`, with the HTTP status from the issue: `not_found` → 404, `not_configured` → 503, everything else → 502.

## Catalog

| Machine | Where | States → transitions | Tests |
|---|---|---|---|
| Remote resource | `lib/resource.ts`, `lib/useResource.ts` | above | `resource.test.ts`, journeys "data tabs" |
| Search | `lib/search.ts` (`SearchController`), `components/TickerSearch.tsx` | `idle → loading → success \| empty \| error`; a newer term aborts the older; Enter resolves to a ticker, `"wait"` (still loading) or nothing | `search.test.ts`, journeys "search:" |
| Quotes | `lib/quotesClient.ts`, `lib/useQuotes.ts` | Per list: `loading` (nothing shown) ⇄ `refreshing` (values shown); `issue` = `beta_expired \| rate_limited \| offline \| upstream` with `retryAt`. Per symbol: value + `stale` when the latest refresh failed. Runs every 60 s while visible and online; newest request wins | `quotesClient.test.ts`, journeys "watchlist:" |
| Chart generator data | `components/charts/ChartBuilder.tsx` (`useSymbolData`) | Per company: `loading → ok \| error` (via `sharedLoader`); a company that is already loaded stays on screen when another is added | journeys "charts:" |
| Chart generator config | `lib/chartConfig.ts`, `ChartBuilder.tsx` | Includes the peer median (`p=1`, only for one company and one SEC metric). Kept in component state (so updates are instant) and mirrored to the URL with `replaceState`. A URL changed from outside (Back, a link) replaces the state. Invalid params fall back to defaults | `chartConfig.test.ts`, journeys "charts:" |
| Stock tabs | `components/StockView.tsx` | `?tab=` in the URL; each tab change is a history entry; a tab mounts on first visit and stays mounted (`visited`) | journeys "stock: tabs…" |
| Price chart settings | `lib/chartSettings.ts` | Range, style and indicators in the URL (`replaceState`, no history spam) | `chartSettings.test.ts`, journeys "stock:" |
| Price chart lifecycle | `components/PriceChart.tsx` | Created once; data, settings and theme update it in place; destroyed on unmount | journeys "chart keeps one canvas set…" |
| Trend chart readout | `components/charts/TrendChart.tsx` | `active` period from pointer or keyboard (←/→/Home/End, Esc clears); focus shows the last period | journeys "charts:" |
| Watchlist and recents | `lib/watchlist.ts` | External stores over `localStorage` (limit, dedupe, corrupted data cleaned); removal shows an undo toast that puts the item back in place | `watchlist.test.ts`, journeys "watchlist:" |
| Hydration | `lib/watchlist.ts` (`useHydrated`) | `server (false) → client (true)`; browser-only data renders a sized skeleton until hydrated, so there's no layout shift | journeys "slow network" |
| Toasts | `components/ui.tsx` (`toast`) | Queue: shown → dismissed (timer, action or close) | journeys "watchlist: remove, undo…" |
| Beta form | `components/BetaGate.tsx` | `idle → checking → (redirect) \| invalid \| closed \| rate_limited \| error`; typing returns to `idle` | — (the codes and tokens behind it: `beta.test.ts`) |
| Beta gate | `src/proxy.ts`, `lib/beta.ts` | Per request: rate limit → open path → valid invite token → else 401 (API) or redirect to `/beta?next=` (pages) | `beta.test.ts`, `infra.test.ts` |
| Section errors | `StockView.tsx` (`SectionBoundary`) | `ok → failed` (render error): that section shows a message; the rest of the page keeps working | — |
| Projections editor | `components/FinancialStatements.tsx` | `off ⇄ editing(draft)`: the draft starts from defaults on first open and is kept when closed; saved scenarios live in `localStorage` | — |
| DCF inputs | `components/valuation/DcfMaker.tsx` | `draft` → validated `result` (or none); defaults restorable; scenarios in `localStorage` | `dcfModel.test.ts` |
| Comps peers | `components/valuation/CompsView.tsx` | Peers and hand-typed market caps per symbol in `localStorage`; a change re-reads comps with `keepPrevious` (table dimmed, `aria-busy`) | `comps.test.ts`, `compsData.test.ts` |
| Language | `lib/i18n/index.tsx` | Cookie → server picks the core dictionary; switching loads core and deep text, then swaps; deep text (stock tabs) suspends under `<DeepI18n>` until loaded | journeys "language switch…" |
| FMP calls | `lib/fmp.ts`, `lib/fmpGuard.ts`, `lib/quota.ts` | On a cache miss: `known answer` (not in the plan: 24 h, not found: 6 h, from Redis) → skip; `paused` (10 min after "limit reached") → `rate_limited` without calling; else call → data or `ProviderError(kind)`. Quote cache: 15 min while the market is open, 60 min once 80 % of the day's calls are used, 6 h when closed. Daily counter logs at 80 % and 100 % | `fmpGuard.test.ts`, `fmp.test.ts`, `infra.test.ts` |
| Stock page price | `lib/data.ts` (`getStockPage`), `lib/priceStore.ts` | `live → stored (last good quote in Postgres) → close (last daily close) → none`; the page opens whenever FMP or the SEC list knows the ticker, else 404. Non-live prices carry `basis` and are labelled with their time and why | `stockPage.test.ts`, `priceStore.test.ts`, journeys "every stock opens" |
| Research notebook | `lib/research.ts`, `lib/researchStore.ts`, `lib/researchClient.ts`, `components/research/` | Note: `never saved (updatedAt null) → saved`; edits are partial. A form edit (thesis, points, plan) made from an older `updatedAt` is refused (`conflict`, 409) instead of overwriting; notes and fair values never conflict. Each fair-value change is logged with the price shown and its source (by hand, DCF). Form: `clean ⇄ dirty → saving → saved \| error \| conflict`; a newer version is taken unless the form has unsaved edits. Owner = beta invite label | `research.test.ts`, `researchServer.test.ts`, journeys "research notebook" |
| Screener | `lib/screener.ts`, `lib/screenerData.ts`, `components/screener/` | Screen in state (instant) → URL after a 300 ms pause → request (`useResource`, `keepPrevious`: the old results stay dimmed while new ones load). The universe (one row per company, latest SEC year) is built from Postgres and kept in memory 6 h per server instance; failures aren't kept. Saved screens live in this browser | `screener.test.ts`, `screenerData.test.ts`, journeys "screener" |
| Quarter in review | `lib/quarterReview.ts`, `/api/sec/quarter/[symbol]`, `components/QuarterCard.tsx` | Latest calendar quarter vs the same quarter a year earlier and the one before; no card when the company has no SEC filings (`not_found`) | `quarterReview.test.ts`, journeys "quarter in review" |
| Watchlist dashboard | `lib/watchDashboard.ts`, `lib/snapshot.ts`, `lib/snapshotClient.ts`, `components/WatchlistView.tsx` | Prices as in Quotes. Per row, the SEC summary: `loading → ok \| error` (`sharedLoader`, at most 3 requests at once); "Try again" asks only for failed rows. Inside a summary, quality, filings and insiders each answer or carry their own issue; insider figures say "partial" while Form 4s are still being read (not cached until done). Sort: `saved` (default) or a column, gaps always last. Tags and columns live in this browser | `watchDashboard.test.ts`, `snapshot.test.ts`, journeys "watchlist dashboard" |
| Filing reader | `lib/filingReader.ts`, `lib/filingReaderData.ts`, `components/reader/` | Section and filing in the URL (`?s=&accn=`, each change a history entry); one request per section (`useResource`, `keepPrevious`). A section is found, missing ("open the original") or cut ("first N words"). Risks against the previous 10-K: `diff \| noPrior \| noTitles \| priorUnavailable` (the last isn't cached, so it's tried again) | `filingReader.test.ts`, journeys "filing reader" |
| Chart packs | `lib/chartPacks.ts`, `lib/chartPacksClient.ts`, `components/charts/PackView.tsx` | Company and pack in the URL (`?s=&p=`, history entries). Built-in packs plus yours (this browser, validated on read; limits refuse an edit rather than drop data). Each card loads its company (`sharedLoader`) and draws once scrolled near. Deleting a pack offers undo | `chartPacks.test.ts`, journeys "chart packs" |
| Peer median | `lib/chartStats.ts`, `components/charts/chartShared.tsx` (`usePeerLine`) | `off → loading → ok \| error(noPeers \| issue)`. Peers: your Comps choice for the stock, else the suggested ones (`/api/sec/peers`). Each peer transformed on its own, matched by period; a period needs 3 peers | `chartPacks.test.ts`, journeys "chart packs" |
| Next earnings | `lib/earnings.ts`, `lib/earningsData.ts`, `components/NextEarnings.tsx` | `listed` (FMP, cached a day) → else `estimated` (52 weeks after last year's 8-K 2.02, no quota) → else `unknown` (no line). The line is hidden while loading or on error | `earnings.test.ts`, journeys "next earnings" |
| Market multiples | `lib/seriesData.ts` | `ok \| sharesMismatch \| noFilings`. Multiples are only shown when the SEC share count is within 10 % of the quote; never in demo mode | — |
| Securities list | `scripts/db-setup.ts`, `/api/cron/securities` | Loaded at build when empty or older than 7 days; refreshed by the daily cron | `securities.test.ts` |
| Health | `/api/health` | Per dependency: `ok \| not_configured \| error`; overall ok unless one is `error` | — |

## Conventions

- **States are a discriminated union** (`status` or `ok`), not several booleans. If two flags can't both be true, they are one state.
- **The newest request wins:** abort or ignore older ones. Never write to state after unmount.
- **Never fill a failure with made-up data:** show the issue and, when it's transient, a retry. Keep last good values on screen only when marked as stale.
- **Pure first:** put transitions in `src/lib/*.ts` and test them there. Components only render states.
- **Tests:** a new machine gets unit tests for its transitions and, when users can see it, a journey in `e2e/journeys.mjs`.
