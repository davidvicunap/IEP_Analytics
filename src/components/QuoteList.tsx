"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { fmtPrice } from "@/lib/format";
import type { DataIssue, Quote } from "@/lib/types";
import { Badge, Change, Skeleton } from "./ui";

export interface Row {
  symbol: string;
  quote?: Quote;
  error?: DataIssue;
  fetchedAt?: string;
  stale?: boolean;
}

/** Latest trade time among the rows, falling back to when they were fetched. */
export function latestAsOf(rows: Row[]): string | undefined {
  return rows
    .flatMap((r) => (r.quote ? [r.quote.asOf ?? r.fetchedAt] : []))
    .filter((s): s is string => !!s)
    .sort()
    .at(-1);
}

/**
 * Aligned quote rows: company on the left, price and the day's change on the right.
 * A quote that failed keeps its row and says why, so the layout never collapses.
 */
export function QuoteRows({
  rows,
  labels,
  caption,
  dense = false,
}: {
  rows: Row[];
  labels?: Record<string, string>;
  caption?: string;
  dense?: boolean;
}) {
  const { t, lang } = useI18n();
  return (
    <ul className="-mx-2" aria-label={caption}>
      {rows.map((r) => {
        const name = labels?.[r.symbol] ?? r.quote?.name;
        return (
          <li key={r.symbol}>
            <Link
              href={`/stock/${encodeURIComponent(r.symbol)}`}
              prefetch={false}
              className={`flex items-center gap-3 px-2 rounded-lg hover:bg-panel-2 transition-colors ${dense ? "min-h-12 py-1.5" : "min-h-14 py-2"}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold leading-tight">{r.symbol}</span>
                {name && <span className="block truncate text-[13px] text-muted">{name}</span>}
              </span>
              {(r.stale || r.quote?.basis) && (
                <Badge tone="warn" className="shrink-0">
                  {t.ux.stale}
                </Badge>
              )}
              {r.quote ? (
                <>
                  <span className="num text-right font-medium">{fmtPrice(r.quote.price, lang)}</span>
                  <Change pct={r.quote.changePercent} pill className="w-[4.75rem] text-[13px]" />
                </>
              ) : (
                <span className="text-right text-xs text-muted">{r.error ? t.data.issuesShort[r.error] : t.ux.loading}</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function QuoteRowsSkeleton({ n, dense = false, note = false, source = false }: { n: number; dense?: boolean; note?: boolean; source?: boolean }) {
  return (
    <div aria-hidden="true">
      <QuoteRowsSkeletonList n={n} dense={dense} />
      {note && <Skeleton className="mt-3 h-4 w-11/12" />}
      {note && <Skeleton className="mt-1 h-4 w-1/2 sm:hidden" />}
      {source && <Skeleton className="mt-2 h-3.5 w-64 max-w-full" />}
    </div>
  );
}

function QuoteRowsSkeletonList({ n, dense = false }: { n: number; dense?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className={`flex items-center gap-3 ${dense ? "min-h-12" : "min-h-14"}`}>
          <span className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-3 w-32" />
          </span>
          <span className="space-y-1.5 flex flex-col items-end">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-14" />
          </span>
        </li>
      ))}
    </ul>
  );
}

