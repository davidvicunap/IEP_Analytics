"use client";

import Link from "next/link";
import { fill, useI18n } from "@/lib/i18n";
import type { DataSource, QuoteEntry } from "@/lib/types";
import { useHydrated, useRecent, useWatchlist } from "@/lib/watchlist";
import { useQuotes } from "@/lib/useQuotes";
import TickerSearch from "./TickerSearch";
import { ChartIcon, ChevronRightIcon, StarIcon } from "./icons";
import { QuoteRows, QuoteRowsSkeleton, ServerQuotes, latestAsOf } from "./QuoteList";
import { EmptyState, Panel, Provenance, StatusMessage } from "./ui";

const MINI_LIMIT = 8;

/** Search first; then market context, saved stocks and companies to discover. */
export default function HomeView({ markets, popular }: { markets: React.ReactNode; popular: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="pt-2 sm:pt-6 max-w-2xl" aria-labelledby="home-title">
        <h1 id="home-title" className="text-[26px] sm:text-[32px] font-semibold tracking-[-0.02em] leading-tight text-balance">
          {t.home.heroTitle}
        </h1>
        <p className="mt-2 text-muted text-[15px] text-pretty max-w-xl">{t.home.heroText}</p>
        <div className="mt-5">
          <TickerSearch large />
        </div>
        <RecentlyViewed />
      </section>

      <section aria-labelledby="markets-title">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="markets-title" className="section-title">
            {t.home.markets}
          </h2>
        </div>
        {markets}
      </section>

      {/* Phones: my list → explore → charts. Wide screens: explore beside my list and charts. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:items-start">
        <Panel title={t.home.popular} id="popular" className="order-2 lg:order-none lg:col-span-2 min-w-0">
          {popular}
        </Panel>
        <div className="max-lg:contents lg:flex lg:flex-col lg:gap-6 min-w-0">
          <div className="order-1 lg:order-none">
            <MiniWatchlist />
          </div>
          <ChartsPromo />
        </div>
      </div>
    </div>
  );
}

export function MarketsSection({ entries, source }: { entries: QuoteEntry[]; source: DataSource }) {
  const { t } = useI18n();
  return (
    <ServerQuotes
      entries={entries}
      source={source}
      caption={t.home.markets}
      note={t.home.etfNote}
      cards={{ indexNames: t.home.indexNames, etfLabel: t.home.etfLabel }}
    />
  );
}

export function PopularSection({ entries, source }: { entries: QuoteEntry[]; source: DataSource }) {
  const { t } = useI18n();
  return <ServerQuotes entries={entries} source={source} caption={t.home.popular} />;
}

function RecentlyViewed() {
  const { t } = useI18n();
  const { list } = useRecent();
  if (list.length === 0) return null;
  return (
    <nav aria-label={t.ux.recent} className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
      <span className="mr-1 text-[13px] text-muted">{t.ux.recent}</span>
      {list.map((s) => (
        <Link
          key={s}
          href={`/stock/${encodeURIComponent(s)}`}
          prefetch={false}
          className="inline-flex items-center h-8 px-2.5 rounded-md bg-panel-2 text-[13px] font-medium hover:bg-line transition-colors"
        >
          {s}
        </Link>
      ))}
    </nav>
  );
}

/** Entry point to the chart generator, with a few ready-made comparisons. */
function ChartsPromo() {
  const { t } = useI18n();
  const presets: { label: string; href: string }[] = [
    { label: t.home.chartsPresets.revenue, href: "/charts?s=AAPL,MSFT,GOOGL&m=revenue&f=annual&t=values&k=bar" },
    { label: t.home.chartsPresets.margins, href: "/charts?s=AAPL,MSFT&m=netMargin&f=annual&k=line" },
    { label: t.home.chartsPresets.pe, href: "/charts?s=NVDA,MSFT,AAPL&m=pe&f=monthly&k=line" },
  ];
  return (
    <section aria-labelledby="charts-promo-title" className="order-3 lg:order-none rounded-xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-panel-2 text-muted" aria-hidden="true">
          <ChartIcon size={18} />
        </span>
        <div className="min-w-0">
          <h2 id="charts-promo-title" className="section-title">
            {t.home.chartsTitle}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted leading-relaxed">{t.home.chartsText}</p>
        </div>
      </div>
      <ul className="mt-3 -mx-2">
        {presets.map((p) => (
          <li key={p.href}>
            <Link href={p.href} className="flex items-center justify-between gap-2 min-h-11 px-2 rounded-lg text-sm hover:bg-panel-2">
              {p.label}
              <ChevronRightIcon size={16} className="text-muted" />
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/charts" className="mt-2 inline-flex items-center gap-1 min-h-11 text-sm font-medium text-fg underline underline-offset-4 decoration-line-strong hover:decoration-fg">
        {t.home.chartsOpen}
      </Link>
    </section>
  );
}

/** First stocks of the watchlist; only the visible ones are requested. */
function MiniWatchlist() {
  const { t } = useI18n();
  const { list } = useWatchlist();
  const shown = list.slice(0, MINI_LIMIT);
  const q = useQuotes(shown);
  const more = list.length - shown.length;
  const hydrated = useHydrated();
  return (
    <Panel
      title={t.watchlist.title}
      id="mini-watchlist"
      action={
        list.length > 0 ? (
          <Link href="/watchlist" className="inline-flex items-center gap-0.5 min-h-11 -my-3 text-[13px] text-muted hover:text-fg">
            {more > 0 ? fill(t.ux.seeAllN, { n: list.length }) : t.ux.seeAll}
            <ChevronRightIcon size={14} />
          </Link>
        ) : undefined
      }
    >
      {!hydrated ? (
        <QuoteRowsSkeleton n={3} dense />
      ) : list.length === 0 ? (
        <EmptyState title={t.ux.emptyTitle}>
          <p className="inline-flex flex-wrap items-center justify-center gap-1">
            {t.ux.emptyHowA}
            <span className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-1.5 py-0.5 text-xs font-medium text-fg" aria-hidden="true">
              <StarIcon size={12} /> {t.stock.addWatch}
            </span>
            {t.ux.emptyHowB}
          </p>
        </EmptyState>
      ) : q.loading ? (
        <QuoteRowsSkeleton n={shown.length} dense />
      ) : (
        <>
          <QuoteRows rows={q.items} dense caption={t.watchlist.title} />
          {q.issue && <StatusMessage tone="warn" className="mt-3">{t.ux.requestIssues[q.issue]}</StatusMessage>}
          {q.source && <Provenance source={q.source} asOf={latestAsOf(q.items)} stale={q.items.some((i) => i.stale)} className="mt-2" />}
        </>
      )}
    </Panel>
  );
}
