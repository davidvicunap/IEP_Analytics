"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { fmtPrice } from "@/lib/format";
import type { Quote } from "@/lib/types";
import { useWatchlist } from "@/lib/watchlist";
import { useQuotes } from "@/lib/useQuotes";
import TickerSearch from "./TickerSearch";
import { Change, Panel, QuoteTile } from "./ui";

export default function HomeView({ indexes, popular }: { indexes: Quote[]; popular: Quote[] }) {
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

      {indexes.length > 0 && (
        <Panel title={t.home.markets}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {indexes.map((q) => (
              <QuoteTile key={q.symbol} q={q} label={t.home.indexNames[q.symbol]} />
            ))}
          </div>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title={t.home.popular} className="lg:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {popular.map((q) => (
              <QuoteTile key={q.symbol} q={q} />
            ))}
          </div>
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
  const quotes = useQuotes(list);
  return (
    <Panel
      title={t.watchlist.title}
      action={list.length > 0 ? <Link href="/watchlist" className="text-xs text-accent">→</Link> : undefined}
    >
      {list.length === 0 ? (
        <p className="text-sm text-muted">{t.watchlist.empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {(quotes ?? []).slice(0, 8).map((q) => (
            <li key={q.symbol}>
              <Link href={`/stock/${q.symbol}`} className="flex items-center justify-between py-2 min-h-11 gap-2">
                <span className="num font-bold text-accent">{q.symbol}</span>
                <span className="num text-sm ml-auto">{fmtPrice(q.price, lang)}</span>
                <Change pct={q.changePercent} className="text-xs w-24 text-right" />
              </Link>
            </li>
          ))}
          {quotes === null && <li className="py-2 text-sm text-muted">…</li>}
        </ul>
      )}
    </Panel>
  );
}
