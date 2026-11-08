"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { fmtPrice } from "@/lib/format";
import { quotesClient } from "@/lib/quotesClient";
import type { DataIssue, DataSource, Quote, QuoteEntry } from "@/lib/types";
import { ChevronRightIcon } from "./icons";
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
 * Aligned quote rows: ticker and name on the left, price and change on the right.
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
    <ul className="divide-y divide-line" aria-label={caption}>
      {rows.map((r) => {
        const name = labels?.[r.symbol] ?? r.quote?.name;
        return (
          <li key={r.symbol}>
            <Link
              href={`/stock/${encodeURIComponent(r.symbol)}`}
              prefetch={false}
              className={`group flex items-center gap-3 -mx-2 px-2 rounded-lg hover:bg-panel-2 ${dense ? "min-h-12 py-1.5" : "min-h-14 py-2"}`}
            >
              <span className="min-w-0 flex-1">
                <span className="num block font-bold text-accent leading-tight">{r.symbol}</span>
                {name && <span className="block truncate text-xs text-muted">{name}</span>}
              </span>
              {r.quote ? (
                <span className="text-right shrink-0">
                  <span className="num block font-semibold leading-tight">{fmtPrice(r.quote.price, lang)}</span>
                  <Change pct={r.quote.changePercent} className="text-xs" />
                </span>
              ) : (
                <span className="text-right shrink-0 text-xs text-muted">
                  <span className="num block text-base leading-tight">—</span>
                  {r.error ? t.data.issuesShort[r.error] : t.ux.loading}
                </span>
              )}
              {r.stale && (
                <Badge tone="warn" className="shrink-0">
                  {t.ux.stale}
                </Badge>
              )}
              <ChevronRightIcon size={16} className="text-muted opacity-0 group-hover:opacity-100 hidden sm:block" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function QuoteRowsSkeleton({ n, dense = false }: { n: number; dense?: boolean }) {
  return (
    <ul className="divide-y divide-line" aria-hidden="true">
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
}: {
  entries: QuoteEntry[];
  source: DataSource;
  labels?: Record<string, string>;
  caption?: string;
  note?: string;
}) {
  useState(() => {
    if (typeof window !== "undefined") quotesClient.prime(entries, source);
  });
  const asOf = latestAsOf(entries);
  return (
    <>
      <QuoteRows rows={entries} labels={labels} caption={caption} />
      {note && <p className="mt-3 text-xs text-muted">{note}</p>}
      {asOf && <Provenance source={source} asOf={asOf} className="mt-2" />}
    </>
  );
}
