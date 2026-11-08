"use client";

import Link from "next/link";
import { fill, useI18n } from "@/lib/i18n";
import type { DataSource, QuoteEntry } from "@/lib/types";
import { useHydrated, useRecent, useWatchlist } from "@/lib/watchlist";
import { useQuotes } from "@/lib/useQuotes";
import TickerSearch from "./TickerSearch";
import { ChevronRightIcon, StarIcon } from "./icons";
import { QuoteRows, QuoteRowsSkeleton, ServerQuotes } from "./QuoteList";
import { EmptyState, Panel, Provenance, StatusMessage, buttonClass } from "./ui";
import { latestAsOf } from "./QuoteList";

const MINI_LIMIT = 8;

/** Search first; then market context, saved stocks and companies to discover. */
export default function HomeView({ markets, popular }: { markets: React.ReactNode; popular: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="pt-2 sm:pt-6 max-w-2xl" aria-labelledby="home-title">
        <h1 id="home-title" className="text-2xl sm:text-3xl font-bold tracking-tight text-balance">
          {t.home.heroTitle}
        </h1>
        <p className="mt-2 text-muted text-sm sm:text-base text-pretty">{t.home.heroText}</p>
        <div className="mt-4">
          <TickerSearch large />
        </div>
        <RecentlyViewed />
      </section>

      {/* Phones: market → my list → explore → how-to. Wide screens: two columns. */}
      <div className="flex flex-col gap-5 sm:gap-6 lg:grid lg:grid-cols-3 lg:items-start">
        <div className="max-lg:contents lg:col-span-2 lg:space-y-6 min-w-0">
          <Panel title={t.home.markets} id="markets" className="order-1">
            {markets}
          </Panel>
          <Panel title={t.home.popular} id="popular" className="order-3">
            {popular}
          </Panel>
        </div>
        <div className="max-lg:contents lg:flex lg:flex-col lg:gap-6 min-w-0">
          <div className="order-2 lg:order-last">
            <MiniWatchlist />
          </div>
          <Panel title={t.home.howTo} className="order-4 lg:order-first">
            <ol className="space-y-2 text-sm list-decimal pl-5 marker:text-accent marker:font-bold">
              {t.home.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}

export function MarketsSection({ entries, source }: { entries: QuoteEntry[]; source: DataSource }) {
  const { t } = useI18n();
  return <ServerQuotes entries={entries} source={source} labels={t.home.etfNames} caption={t.home.markets} note={t.home.etfNote} />;
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
    <nav aria-label={t.ux.recent} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs text-muted">{t.ux.recent}:</span>
      {list.map((s) => (
        <Link
          key={s}
          href={`/stock/${encodeURIComponent(s)}`}
          prefetch={false}
          className="num inline-flex items-center h-9 px-3 rounded-full border border-line bg-panel text-xs font-semibold hover:border-accent"
        >
          {s}
        </Link>
      ))}
    </nav>
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
          <Link href="/watchlist" className="inline-flex items-center gap-1 min-h-11 -my-3 text-xs font-semibold text-accent">
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
            <span className={buttonClass("secondary", true, "pointer-events-none !h-7 !px-2 text-xs")} aria-hidden="true">
              <StarIcon size={14} /> {t.stock.addWatch}
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
