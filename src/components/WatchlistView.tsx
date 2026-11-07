"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { fmtBig, fmtPrice } from "@/lib/format";
import { useQuotes } from "@/lib/useQuotes";
import { useWatchlist } from "@/lib/watchlist";
import TickerSearch from "./TickerSearch";
import { Change, Panel } from "./ui";

export default function WatchlistView() {
  const { t, lang } = useI18n();
  const { list, remove } = useWatchlist();
  const state = useQuotes(list);
  const bySymbol = new Map((state?.quotes ?? []).map((q) => [q.symbol, q]));
  const missing = new Map((state?.missing ?? []).map((m) => [m.symbol, m.error]));

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">{t.watchlist.title}</h1>
      <TickerSearch large />
      <Panel>
        {list.length === 0 ? (
          <p className="text-sm text-muted py-4 text-center">{t.watchlist.empty}</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((s) => {
              const q = bySymbol.get(s);
              const issue = missing.get(s);
              return (
                <li key={s} className="flex items-center gap-3 py-2">
                  <Link href={`/stock/${s}`} className="flex flex-1 min-w-0 items-center gap-3 min-h-12">
                    <span className="num font-bold text-accent w-16 shrink-0">{s}</span>
                    <span className="truncate text-sm text-muted hidden sm:block flex-1">{q?.name}</span>
                    <span className="ml-auto text-right">
                      <span className="num block">{q ? fmtPrice(q.price, lang) : issue ? "—" : "…"}</span>
                      {q && <Change pct={q.changePercent} className="text-xs" />}
                      {!q && issue && <span className="text-xs text-muted">{t.data.issuesShort[issue]}</span>}
                    </span>
                    <span className="num text-xs text-muted w-16 text-right hidden md:block">
                      {q?.marketCap ? `$${fmtBig(q.marketCap, lang)}` : ""}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(s)}
                    className="h-10 w-10 shrink-0 rounded-md border border-line hover:bg-down-bg hover:text-down"
                    aria-label={`${t.watchlist.remove} ${s}`}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <p className="text-xs text-muted">{t.watchlist.note}</p>
    </div>
  );
}
