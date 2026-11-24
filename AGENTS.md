# Working on Investment Edge Platform (IEP)

US stock analysis in plain language (ES/EN). Next.js 16 App Router on Vercel, React 19, TypeScript strict, Tailwind 4. Product plan: `PRODUCT_PLAN.md`.

## Check your change

```bash
npm run typecheck
npm test                                   # vitest, src/**/*.test.ts
env -u DATABASE_URL -u FMP_API_KEY npm run build
npm run start:demo                         # demo data on http://localhost:3123
npm run e2e                                # browser journeys (see e2e/README.md)
```

- Tests and browser checks run on **demo data**. Never point them at production or spend the FMP quota (250 calls/day on the current plan).
- CI runs typecheck, tests and build on every PR.

## Where things are

- `src/lib/`: data access, financial maths and state machines, all pure and unit-tested. `fmp.ts` and `sec*.ts` are the providers; `data.ts` is the facade; `resource.ts` holds the client fetch machine.
- `src/app/api/*`: JSON routes that return `Result<T>` (`{ ok, data, fetchedAt }` or `{ ok: false, error: DataIssue }`).
- `src/components/`: views. The home page is the research hub (`home/ResearchHub.tsx`: theses and canvases); the portfolio lives at `/portfolio`. Stock page tabs live in `StockView.tsx` (Overview, Finanzas, Valuation, Filings, My research); Finanzas is `FinancialHighlights.tsx` + `FinancialStatements.tsx` over `lib/financialsView.ts`; the Trading Canvas (infinite canvas of windows, `/canvas`, `?s=AAPL` opens or starts one for a company) in `canvas/`, its model in `lib/canvas.ts`. Panels shown inside a canvas window render without their box under `<InWindow>`.
- `src/lib/features.ts`: tools left out of the MVP's navigation (chart generator, packs, compare, calendar, track record, broker import, Telegram). Their code and URLs stay; flip a flag to offer one again.
- Comps market values are SEC cover-page shares × price (`lib/marketCap.ts`); no paid market-cap feed.
- Local checks on real SEC data without spending FMP calls: `LOCAL_PGLITE_DIR=.local/pg npm run db:local` fills an in-process Postgres (see `scripts/local-db.ts`); run the app with the same variable and `BETA_GATE=off`.
- `src/lib/i18n/`: `es.ts` / `en.ts` ship with every page; `esDeep.ts` / `enDeep.ts` hold the stock tabs' and charts' text, loaded under `<DeepI18n>`. Add every string in both languages.

## Rules

- **State machines:** read `docs/state-machines.md` first.
  - To fetch our API from a client component, use `useResource` (or `sharedLoader`) and render its three states.
  - Show errors with `<IssueNote issue onRetry>`.
  - Don't hand-roll `useEffect` + `fetch` + flags, and never cast to `DataIssue`.
- **Honest data:**
  - Every number shows its source and time.
  - A failure is shown as such, never filled with made-up or demo data.
  - Demo data is never mixed with real data.
- **Research notebooks, trades, phone-alert devices and account settings** (watchlist, tags, columns, chart packs, saved screens, risk; `lib/prefs.ts`) belong to the beta invite's label (`david:IEP-…` → `david`): renaming a label in `BETA_INVITE_CODES` starts that person empty. In demo mode without a database they live in memory.
- **Secrets:** they stay server-side, in env vars. The Web Push key pair comes from `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` or is created once in the database. Telegram alerts need `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` (off otherwise); `/stats` shows to labels in `ADMIN_LABELS`. Demo mode reads `DEMO_SPLITS`, `DEMO_LISTINGS` and `DEMO_TELEGRAM` (a pretend bot) for browser checks. The beta gate (`src/proxy.ts`) guards licensed data; only `/api/sec/*` (public domain), health, cron and the Telegram webhook (it checks Telegram's secret) are open.
- **UI:**
  - Use the tokens in `globals.css` and the primitives in `components/ui.tsx`.
  - Follow the design standards in `CLAUDE.md`: warm neutral surfaces, hairline borders (`border-line`), no blur or decorative gradients, no box where whitespace already separates (`<Panel bare>`).
  - The ink-blue `accent` is for the single most important action on a screen (and the focus ring); selection is shown in ink (`fg`). Amber is for warnings, green/red for price direction and gains/losses; charts use `--series-*`. Shadows (`shadow-pop`) only on menus, popovers and dialogs.
  - Page titles (`h1`) are set in the serif (Newsreader); the interface and numbers in Geist with `tabular-nums`.
  - Touch targets of 44 px on phones; no horizontal scroll from 320 px.
- **Measurement:** product events are first-party and anonymous in content (`lib/funnel.ts`): add a name there before tracking it, never tickers or amounts.
- **Educational, not advice:** no buy/sell language.
