"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { fmtPrice } from "@/lib/format";
import type { DataSource, QuoteEntry } from "@/lib/types";
import { useWatchlist } from "@/lib/watchlist";
import { useQuotes } from "@/lib/useQuotes";
import TickerSearch from "./TickerSearch";
import { Change, MissingTile, Panel, Provenance, QuoteTile } from "./ui";

/** Latest trade time among the quotes, falling back to when they were fetched. */
function latestAsOf(entries: QuoteEntry[]): string | undefined {
  return entries
    .map((e) => e.quote?.asOf ?? e.fetchedAt)
    .filter((s): s is string => !!s)
    .sort()
    .at(-1);
}

/** Shown only when at least one quote loaded: a source line under empty tiles would mislead. */
function ProvenanceIfAny({ source, entries }: { source: DataSource; entries: QuoteEntry[] }) {
  const asOf = latestAsOf(entries.filter((e) => e.quote));
  return asOf ? <Provenance source={source} asOf={asOf} className="mt-3" /> : null;
}

function Tiles({ entries, labels }: { entries: QuoteEntry[]; labels?: Record<string, string> }) {
  return (
    <>
      {entries.map((e) =>
        e.quote ? (
          <QuoteTile key={e.symbol} q={e.quote} label={labels?.[e.symbol]} />
        ) : (
          <MissingTile key={e.symbol} symbol={e.symbol} label={labels?.[e.symbol]} issue={e.error ?? "upstream"} />
        ),
      )}
    </>
  );
}

export default function HomeView({
  indexes,
  popular,
  source,
}: {
  indexes: QuoteEntry[];
  popular: QuoteEntry[];
  source: DataSource;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <section className="pt-4 pb-2 md:pt-10 md:pb-4 text-center max-w-2xl mx-auto">
        <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-balance">{t.home.heroTitle}</h1>
        <p className="mt-3 text-muted text-sm sm:text-base text-pretty">{t.home.heroText}</p>
        <div className="mt-5 text-left">
          <TickerSearch large />
        </div>
      </section>

      <Panel title={t.home.markets}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tiles entries={indexes} labels={t.home.indexNames} />
        </div>
        <ProvenanceIfAny source={source} entries={indexes} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title={t.home.popular} className="lg:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            <Tiles entries={popular} />
          </div>
          <ProvenanceIfAny source={source} entries={popular} />
        </Panel>
        <div className="space-y-6">
          <MiniWatchlist />
          <Panel title={t.home.howTo}>
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

function MiniWatchlist() {
  const { t, lang } = useI18n();
  const { list } = useWatchlist();
  const state = useQuotes(list);
  const bySymbol = new Map((state?.quotes ?? []).map((q) => [q.symbol, q]));
  const missing = new Map((state?.missing ?? []).map((m) => [m.symbol, m.error]));
  return (
    <Panel
      title={t.watchlist.title}
      action={list.length > 0 ? <Link href="/watchlist" className="text-xs text-accent">→</Link> : undefined}
    >
      {list.length === 0 ? (
        <p className="text-sm text-muted">{t.watchlist.empty}</p>
      ) : state === null ? (
        <p className="py-2 text-sm text-muted">…</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.slice(0, 8).map((symbol) => {
            const q = bySymbol.get(symbol);
            const issue = missing.get(symbol);
            return (
              <li key={symbol}>
                <Link href={`/stock/${symbol}`} className="flex items-center justify-between py-2 min-h-11 gap-2">
                  <span className="num font-bold text-accent">{symbol}</span>
                  {q ? (
                    <>
                      <span className="num text-sm ml-auto">{fmtPrice(q.price, lang)}</span>
                      <Change pct={q.changePercent} className="text-xs w-24 text-right" />
                    </>
                  ) : (
                    <span className="ml-auto text-xs text-muted">{issue ? t.data.issuesShort[issue] : "—"}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
