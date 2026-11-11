"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { fmtPrice } from "@/lib/format";
import { quotesClient } from "@/lib/quotesClient";
import type { DataIssue, DataSource, Quote, QuoteEntry } from "@/lib/types";
import { Badge, Change, Provenance, Skeleton } from "./ui";

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

/** Index ETFs as compact cards: the index name first, then the ETF that tracks it. */
export function MarketCards({ rows, indexNames, etfLabel }: { rows: Row[]; indexNames: Record<string, string>; etfLabel: string }) {
  const { t, lang } = useI18n();
  return (
    <ul className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
      {rows.map((r) => (
        <li key={r.symbol} className="min-w-0">
          <Link
            href={`/stock/${encodeURIComponent(r.symbol)}`}
            prefetch={false}
            className="block h-full rounded-lg border border-line px-3 py-2.5 hover:border-line-strong hover:bg-panel-2 transition-colors"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] font-medium">{indexNames[r.symbol] ?? r.symbol}</span>
              <span className="shrink-0 text-[11px] text-muted">
                {r.stale || r.quote?.basis ? t.ux.stale : `${etfLabel} ${r.symbol}`}
              </span>
            </span>
            {r.quote ? (
              <span className="mt-1.5 flex items-baseline justify-between gap-2">
                <span className="num text-[17px] font-semibold tracking-tight">{fmtPrice(r.quote.price, lang)}</span>
                <Change pct={r.quote.changePercent} className="text-[13px]" />
              </span>
            ) : (
              <span className="mt-1.5 block text-[13px] text-muted">{r.error ? t.data.issuesShort[r.error] : t.ux.loading}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function MarketCardsSkeleton({ n }: { n: number }) {
  return (
    <div aria-hidden="true">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {Array.from({ length: n }, (_, i) => (
          <Skeleton key={i} className="h-[66px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="mt-3 h-4 w-11/12" />
      <Skeleton className="mt-1 h-4 w-1/2 sm:hidden" />
      <Skeleton className="mt-2 h-4 w-64 max-w-full" />
    </div>
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

/** Server-rendered quotes: shows them and seeds the shared client cache (browser only). */
export function ServerQuotes({
  entries,
  source,
  labels,
  caption,
  note,
  cards,
}: {
  entries: QuoteEntry[];
  source: DataSource;
  labels?: Record<string, string>;
  caption?: string;
  note?: string;
  cards?: { indexNames: Record<string, string>; etfLabel: string };
}) {
  useState(() => {
    if (typeof window !== "undefined") quotesClient.prime(entries, source);
  });
  const asOf = latestAsOf(entries);
  return (
    <>
      {cards ? <MarketCards rows={entries} {...cards} /> : <QuoteRows rows={entries} labels={labels} caption={caption} />}
      {note && <p className="mt-3 text-xs text-muted">{note}</p>}
      {asOf && <Provenance source={source} asOf={asOf} className="mt-2" />}
    </>
  );
}
