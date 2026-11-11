# Working on IEP Analytics

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
- `src/components/`: views. Stock page tabs live in `StockView.tsx`; the chart generator in `charts/`.
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
- **Research notebooks** belong to the beta invite's label (`david:IEP-…` → `david`): renaming a label in `BETA_INVITE_CODES` starts that person on an empty notebook. In demo mode without a database they live in memory.
- **Secrets:** they stay server-side, in env vars. The beta gate (`src/proxy.ts`) guards licensed data; only `/api/sec/*` (public domain) and health are open.
- **UI:**
  - Use the tokens in `globals.css` and the primitives in `components/ui.tsx`.
  - Amber accent for actions and selection only; charts use `--series-*`.
  - Touch targets of 44 px on phones; no horizontal scroll from 320 px.
- **Educational, not advice:** no buy/sell language.
