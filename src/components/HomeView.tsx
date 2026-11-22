"use client";

import Link from "next/link";
import { fill, useI18n } from "@/lib/i18n";
import type { DataSource, QuoteEntry } from "@/lib/types";
import { useHydrated, useRecent, useWatchlist } from "@/lib/watchlist";
import { useQuotes } from "@/lib/useQuotes";
import Briefing from "./Briefing";
import GettingStarted from "./GettingStarted";
import Portfolio from "./portfolio/Portfolio";
import TickerSearch from "./TickerSearch";
import { ChevronRightIcon, StarIcon } from "./icons";
import { QuoteRows, QuoteRowsSkeleton, ServerQuotes, latestAsOf } from "./QuoteList";
import { EmptyState, Panel, Provenance, StatusMessage } from "./ui";

const MINI_LIMIT = 8;

/**
 * Following stocks: the morning briefing first, then the market, the watchlist and other ideas.
 * Not yet (or before this browser's list is read): search first, then companies to discover.
 */
export default function HomeView({ markets, popular }: { markets: React.ReactNode; popular: React.ReactNode }) {
  const { t } = useI18n();
  const { list } = useWatchlist();
  const hydrated = useHydrated();
  const marketsSection = (
    <Panel title={t.home.markets} id="markets" className="min-w-0" bare>
      {markets}
    </Panel>
  );

  if (hydrated && list.length > 0) {
    return (
      <div className="space-y-8 pt-2 sm:pt-6">
        <Briefing
          list={list}
          search={
            <>
              <TickerSearch />
              <RecentlyViewed />
            </>
          }
          portfolio={<Portfolio />}
        />
        <GettingStarted />
        {/* Tools (screener, charts, compare…) live under "Tools"; home stays about what you own and follow. */}
        <div className="grid gap-6 lg:grid-cols-3 lg:items-start lg:gap-8">
          <div className="min-w-0 lg:col-span-2">{marketsSection}</div>
          <div className="min-w-0">
            <MiniWatchlist />
          </div>
        </div>
      </div>
    );
  }

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

      {/* Start from what you own: the first thing to do here. */}
      {hydrated && <Portfolio />}

      <GettingStarted />

      {marketsSection}

      {/* Phones: my list, then ideas. Wide screens: ideas beside my list. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-3 lg:items-start">
        <Panel bare title={t.home.popular} id="popular" className="order-2 lg:order-none lg:col-span-2 min-w-0">
          {popular}
        </Panel>
        <div className="order-1 lg:order-none min-w-0">
          <MiniWatchlist />
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
  const { list } = useWatchlist();
  // Ideas, not repeats: stocks already in the list are left out (unless that leaves too few).
  const others = entries.filter((e) => !list.includes(e.symbol));
  return <ServerQuotes entries={others.length >= 3 ? others : entries} source={source} caption={t.home.popular} />;
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
          className="inline-flex items-center h-8 px-2.5 rounded-md border border-line text-[13px] font-medium hover:bg-panel-2 transition-colors"
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
      bare
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
