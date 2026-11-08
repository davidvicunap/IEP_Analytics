"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtBig, fmtPrice } from "@/lib/format";
import { useQuotes } from "@/lib/useQuotes";
import { sortItems, type Sort } from "@/lib/watchlistSort";
import { useHydrated, useWatchlist, WATCHLIST_LIMIT } from "@/lib/watchlist";
import TickerSearch from "./TickerSearch";
import { CloseIcon, RefreshIcon, StarIcon } from "./icons";
import { QuoteRowsSkeleton } from "./QuoteList";
import { Badge, Change, EmptyState, Panel, Provenance, Skeleton, StatusMessage, buttonClass, toast } from "./ui";

export default function WatchlistView() {
  const { t, lang } = useI18n();
  const { list, remove, add, persistent } = useWatchlist();
  const q = useQuotes(list);
  const [sort, setSort] = useState<Sort>("saved");
  const hydrated = useHydrated();
  const rows = useMemo(() => sortItems(q.items, sort), [q.items, sort]);
  const failed = q.items.filter((i) => !i.quote && i.error).length;
  const latest = q.items.map((i) => i.quote?.asOf ?? i.fetchedAt).filter((x): x is string => !!x).sort().at(-1);

  const removeWithUndo = (s: string) => {
    const index = list.indexOf(s);
    remove(s);
    toast({ message: fill(t.ux.removed, { s }), action: { label: t.ux.undo, run: () => add(s, index) } });
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-bold">{t.watchlist.title}</h1>
        {list.length > 0 && (
          <p className="text-xs text-muted num">{fill(t.ux.countOf, { n: list.length, max: WATCHLIST_LIMIT })}</p>
        )}
      </div>
      <div className="max-w-xl">
        <TickerSearch large />
      </div>

      <Panel>
        {!hydrated ? (
          <>
            <Skeleton className="h-11 w-56 mb-2" />
            <QuoteRowsSkeleton n={4} />
          </>
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
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <label className="inline-flex items-center gap-2 text-sm">
                <span className="text-muted">{t.ux.sortBy}</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  className="h-11 rounded-lg border border-line bg-panel px-2 text-sm"
                >
                  {(Object.keys(t.ux.sorts) as Sort[]).map((k) => (
                    <option key={k} value={k}>
                      {t.ux.sorts[k]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={q.refresh} disabled={q.refreshing || q.loading} className={buttonClass("ghost", true, "ml-auto text-muted")}>
                <RefreshIcon size={16} className={q.refreshing ? "animate-spin motion-reduce:animate-none" : ""} />
                {q.refreshing ? t.ux.refreshing : t.ux.refresh}
              </button>
            </div>

            {q.loading ? (
              <>
                <p role="status" className="sr-only">{t.ux.loading}</p>
                <QuoteRowsSkeleton n={Math.min(list.length, 30)} />
              </>
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((r) => (
                  <li key={r.symbol} className="flex items-center gap-2">
                    <Link href={`/stock/${encodeURIComponent(r.symbol)}`} prefetch={false} className="flex flex-1 min-w-0 items-center gap-3 min-h-14 py-2 -ml-2 pl-2 rounded-lg hover:bg-panel-2">
                      <span className="min-w-0 flex-1">
                        <span className="num block font-bold text-accent leading-tight">{r.symbol}</span>
                        <span className="block truncate text-xs text-muted">{r.quote?.name ?? (r.error ? t.data.issuesShort[r.error] : "")}</span>
                      </span>
                      <span className="num text-xs text-muted w-20 text-right hidden md:block">
                        {r.quote?.marketCap ? `$${fmtBig(r.quote.marketCap, lang)}` : ""}
                      </span>
                      <span className="text-right shrink-0">
                        <span className="num block font-semibold leading-tight">{r.quote ? fmtPrice(r.quote.price, lang) : "—"}</span>
                        {r.quote ? <Change pct={r.quote.changePercent} className="text-xs" /> : <span className="text-xs text-muted">{t.ux.noPrice}</span>}
                      </span>
                      {r.stale && <Badge tone="warn">{t.ux.stale}</Badge>}
                    </Link>
                    <button
                      type="button"
                      onClick={() => removeWithUndo(r.symbol)}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-down-bg hover:text-down"
                      aria-label={fill(t.ux.removeX, { s: r.symbol })}
                    >
                      <CloseIcon size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {q.issue && (
              <StatusMessage tone="warn" className="mt-3" action={q.issue === "beta_expired" ? <Link href="/beta?next=/watchlist" className="text-sm font-semibold text-accent underline">{t.ux.signInAgain}</Link> : undefined}>
                {t.ux.requestIssues[q.issue]}
                {q.retryAt && ` ${fill(t.ux.retryAt, { time: fmtAsOf(new Date(q.retryAt).toISOString(), lang) })}`}
              </StatusMessage>
            )}
            {!q.issue && failed > 0 && (
              <StatusMessage tone="warn" className="mt-3">
                {fill(t.ux.partial, { n: failed, total: list.length })}
              </StatusMessage>
            )}
            {q.source && <Provenance source={q.source} asOf={latest} stale={q.items.some((i) => i.stale)} className="mt-3" />}
          </>
        )}
      </Panel>
      <p className="text-xs text-muted">{persistent ? t.watchlist.note : t.ux.memoryOnly}</p>
    </div>
  );
}
