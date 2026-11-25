"use client";

import Link from "next/link";
import { fill, useI18n } from "@/lib/i18n";
import { useHydrated, useRecent, useWatchlist } from "@/lib/watchlist";
import { useQuotes } from "@/lib/useQuotes";
import { ChevronRightIcon, StarIcon } from "../icons";
import { QuoteRows, QuoteRowsSkeleton, latestAsOf } from "../QuoteList";
import { EmptyState, Panel, Provenance, StatusMessage } from "../ui";

const MINI_LIMIT = 8;

export function RecentlyViewed() {
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
export function MiniWatchlist() {
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
