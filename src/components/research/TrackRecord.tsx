"use client";

// "My track record" (/research/results): the last 7 days, the scorecard of closed trades
// (hit rate, average result, R, stops respected, the S&P 500 over the same dates), open
// positions at today's price and every closed trade. Everything comes from the trades the user
// logged; prices and the benchmark say where they come from. Text: `trades` (deep dictionary).
import Link from "next/link";
import { useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { useNotes, useTheses } from "@/lib/researchClient";
import { useSymbolInfo } from "@/lib/symbolsClient";
import { useBenchmark, useTrades } from "@/lib/tradesClient";
import { book, lastWeek, positions, scorecard, type ClosedTrade, type Position, type Trade } from "@/lib/trades";
import { useQuotes } from "@/lib/useQuotes";
import { EmptyState, IssueNote, Panel, Provenance, Skeleton, StatusMessage } from "../ui";

type Lang = "es" | "en";
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const signedPct = (v: number, lang: Lang) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(v) * 100, lang, 1)}%`;
const signedMoney = (v: number, lang: Lang) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtPrice(Math.abs(v), lang)}`;

export default function TrackRecord() {
  const { t, lang } = useI18n();
  const T = t.trades;
  const { state, retry } = useTrades();
  const [today] = useState(localToday);
  const trades = state.status === "ok" ? state.data : state.status === "loading" ? (state.previous?.data ?? null) : null;
  const info = useSymbolInfo(useMemo(() => [...new Set((trades ?? []).map((x) => x.symbol))], [trades]));
  const b = useMemo(() => book(trades ?? [], info.splits), [trades, info.splits]);
  const open = useMemo(() => positions(b.open), [b]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <p className="text-sm">
          <Link href="/research" prefetch={false} className="link">
            {t.research.pageTitle}
          </Link>
        </p>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{T.title}</h1>
        <p className="mt-1 text-[15px] text-muted">{T.intro}</p>
      </div>
      {state.status === "error" ? (
        <Panel>
          <IssueNote issue={state.issue} onRetry={retry} />
        </Panel>
      ) : !trades ? (
        <Panel>
          <p role="status" className="sr-only">
            {t.ux.loading}
          </p>
          <Skeleton className="h-40 w-full rounded-lg" />
        </Panel>
      ) : trades.length === 0 ? (
        <Panel>
          <EmptyState title={T.title}>{T.empty}</EmptyState>
        </Panel>
      ) : (
        <>
          {b.oversold.length > 0 && <StatusMessage tone="warn">{fill(T.oversoldWarning, { list: [...new Set(b.oversold.map((o) => o.symbol))].join(", ") })}</StatusMessage>}
          <Week trades={trades} closed={b.closed} open={open} today={today} />
          <Score closed={b.closed} />
          <Positions open={open} />
          <Closed closed={b.closed} />
          <p className="text-xs text-muted">{T.source}</p>
        </>
      )}
      <p className="text-xs text-muted">{T.disclaimer}</p>
    </div>
  );
}

function Week({ trades, closed, open, today }: { trades: Trade[]; closed: ClosedTrade[]; open: Position[]; today: string }) {
  const { t, lang } = useI18n();
  const T = t.trades;
  const w = lastWeek(trades, closed, today);
  const notes = useNotes();
  const theses = useTheses();
  const q = useQuotes(open.filter((p) => p.stop !== null).map((p) => p.symbol), { enabled: open.some((p) => p.stop !== null) });
  const alerts = theses.state.status === "ok" ? theses.state.data.items.flatMap((i) => i.alerts).filter((a) => a.firedAt.slice(0, 10) >= w.from).length : null;
  const closedTheses = notes.state.status === "ok" ? notes.state.data.filter((n) => n.closed && n.closed.at.slice(0, 10) >= w.from).length : 0;
  const word = (n: number) => (n === 1 ? T.tradeWord.one : T.tradeWord.many);
  const near = open.flatMap((p) => {
    const price = q.items.find((i) => i.symbol === p.symbol)?.quote?.price;
    if (!price || p.stop === null) return [];
    const gap = price / p.stop - 1;
    if (gap < 0) return [fill(T.belowStop, { s: p.symbol, v: fmtPrice(p.stop, lang) })];
    return gap <= 0.05 ? [fill(T.nearStop, { s: p.symbol, p: `${fmtNum(gap * 100, lang, 1)}%`, v: fmtPrice(p.stop, lang) })] : [];
  });
  return (
    <Panel title={T.weekTitle} id="week">
      <ul className="space-y-1.5 text-sm" data-testid="week">
        <li>{fill(T.weekTrades, { b: `${w.buys} ${w.buys === 1 ? T.buyWord.one : T.buyWord.many}`, s: `${w.sells} ${w.sells === 1 ? T.sellWord.one : T.sellWord.many}` })}</li>
        {w.closed.length > 0 && <li className="num">{fill(T.weekClosed, { n: w.closed.length, w: word(w.closed.length), v: signedMoney(w.realized, lang) })}</li>}
        {theses.state.status === "error" ? (
          <li>
            <IssueNote issue={theses.state.issue} onRetry={theses.retry} />
          </li>
        ) : (
          alerts !== null && <li>{alerts === 0 ? T.weekAlertsNone : alerts === 1 ? T.weekAlertsOne : fill(T.weekAlerts, { n: alerts })}</li>
        )}
        {closedTheses > 0 && <li>{fill(T.weekTheses, { n: closedTheses })}</li>}
        {near.map((s) => (
          <li key={s} className="text-warn">
            {s}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Score({ closed }: { closed: ClosedTrade[] }) {
  const { t, lang } = useI18n();
  const T = t.trades;
  const bench = useBenchmark();
  const spy = bench.state.status === "ok" ? bench.state.data.closes : null;
  const s = useMemo(() => scorecard(closed, spy), [closed, spy]);
  if (!closed.length) {
    return (
      <Panel title={T.scoreTitle} id="score">
        <p className="text-sm text-muted">{T.closedNone}</p>
      </Panel>
    );
  }
  const dash = "—";
  const tiles: { k: string; v: string; note?: React.ReactNode }[] = [
    { k: T.score.closed, v: String(s.closed) },
    { k: T.score.winRate, v: s.winRate === null ? dash : `${fmtNum(s.winRate * 100, lang, 0)}%`, note: fill(T.winRateNote, { w: s.wins, n: s.closed }) },
    { k: T.score.avgReturn, v: s.avgReturn === null ? dash : signedPct(s.avgReturn, lang), note: fill(T.avgSplit, { w: s.avgWin === null ? dash : signedPct(s.avgWin, lang), l: s.avgLoss === null ? dash : signedPct(s.avgLoss, lang) }) },
    { k: T.score.avgR, v: s.avgR === null ? dash : `${s.avgR > 0 ? "+" : s.avgR < 0 ? "−" : ""}${fmtNum(Math.abs(s.avgR), lang, 2)} R`, note: s.withStop ? fill(T.rNote, { n: s.withStop }) : T.rNone },
    { k: T.score.stops, v: s.withStop ? fill(T.stopsValue, { k: s.withStop - s.pastStop, n: s.withStop }) : dash, note: T.stopsNote },
    { k: T.score.days, v: s.avgDays === null ? dash : fmtNum(s.avgDays, lang, 0) },
    { k: T.score.realized, v: signedMoney(s.realized, lang) },
    {
      k: T.score.bench,
      v: s.benchmark.avgReturn === null ? dash : signedPct(s.benchmark.avgReturn, lang),
      note:
        bench.state.status === "error" ? (
          <IssueNote issue={bench.state.issue} onRetry={bench.retry} />
        ) : bench.state.status === "ok" && s.benchmark.covered > 0 ? (
          fill(T.benchNote, { n: s.benchmark.covered, w: s.benchmark.covered === 1 ? T.tradeWord.one : T.tradeWord.many, src: T.benchSource[bench.state.data.source], t: fmtAsOf(bench.state.fetchedAt, lang) })
        ) : bench.state.status === "ok" ? (
          T.benchMissing
        ) : undefined,
    },
  ];
  return (
    <Panel title={T.scoreTitle} id="score">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4" data-testid="scorecard">
        {tiles.map((x) => (
          <div key={x.k} className="min-w-0">
            <dt className="text-xs text-muted">{x.k}</dt>
            <dd className="num mt-0.5 text-lg font-semibold">{x.v}</dd>
            {x.note && <dd className="mt-0.5 text-xs text-muted">{x.note}</dd>}
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function Positions({ open }: { open: Position[] }) {
  const { t, lang } = useI18n();
  const T = t.trades;
  const q = useQuotes(open.map((p) => p.symbol), { enabled: open.length > 0 });
  const asOf = q.items.map((i) => i.fetchedAt).filter((x): x is string => !!x).sort().at(-1);
  return (
    <Panel title={T.posTitle} id="positions">
      {open.length === 0 ? (
        <p className="text-sm text-muted">{T.posNone}</p>
      ) : (
        <>
          <ul className="divide-y divide-line" data-testid="positions">
            {open.map((p) => {
              const item = q.items.find((i) => i.symbol === p.symbol);
              const price = item?.quote?.price ?? null;
              const value = price === null ? null : p.shares * price;
              const gain = value === null ? null : value - p.cost;
              return (
                <li key={p.symbol}>
                  <Link href={`/stock/${encodeURIComponent(p.symbol)}?tab=research`} prefetch={false} className="num -mx-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg px-2 py-3 text-sm hover:bg-panel-2 sm:grid-cols-[1fr_auto_auto_auto]">
                    <span className="min-w-0">
                      <span className="block font-semibold">{p.symbol}</span>
                      <span className="block text-xs text-muted">
                        {fmtNum(p.shares, lang, 6)} × {fmtPrice(p.avgPrice, lang)}
                      </span>
                    </span>
                    <span className="text-right sm:w-28">
                      <span className="block text-xs text-muted">{T.posCols.value}</span>
                      {value === null ? (item?.error ? t.data.issuesShort[item.error] : "—") : fmtPrice(value, lang)}
                    </span>
                    <span className="sm:w-28 sm:text-right">
                      <span className="block text-xs text-muted">{T.posCols.pnl}</span>
                      {gain === null ? "—" : `${signedMoney(gain, lang)} (${signedPct(gain / p.cost, lang)})`}
                    </span>
                    <span className="text-right sm:w-28">
                      <span className="block text-xs text-muted">{T.posCols.stop}</span>
                      {p.stop === null || price === null ? "—" : signedPct(p.stop / price - 1, lang)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {q.source && <Provenance source={q.source} asOf={asOf} stale={q.items.some((i) => i.stale)} className="mt-2" />}
        </>
      )}
    </Panel>
  );
}

function Closed({ closed }: { closed: ClosedTrade[] }) {
  const { t, lang } = useI18n();
  const T = t.trades;
  const rows = [...closed].reverse();
  return (
    <Panel title={T.closedTitle} id="closed">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{T.closedNone}</p>
      ) : (
        <ul className="divide-y divide-line" data-testid="closed-trades">
          {rows.map((c, i) => (
            <li key={`${c.symbol}-${c.buyDate}-${c.sellDate}-${i}`} className="num grid grid-cols-2 gap-x-4 gap-y-1 py-3 text-sm sm:grid-cols-[1fr_auto_auto_auto]">
              <span className="min-w-0">
                <span className="block font-semibold">{c.symbol}</span>
                <span className="block text-xs text-muted">
                  {fmtDate(c.buyDate, lang)} → {fmtDate(c.sellDate, lang)}
                </span>
              </span>
              <span className="text-right sm:w-36">
                <span className="block text-xs text-muted">
                  {T.closedCols.buy} → {T.closedCols.sell}
                </span>
                {fmtNum(c.shares, lang, 6)} × {fmtPrice(c.buyPrice, lang)} → {fmtPrice(c.sellPrice, lang)}
              </span>
              <span className="sm:w-32 sm:text-right">
                <span className="block text-xs text-muted">{T.closedCols.pnl}</span>
                {signedMoney(c.pnl, lang)} ({signedPct(c.ret, lang)})
              </span>
              <span className="text-right sm:w-16">
                <span className="block text-xs text-muted">{T.closedCols.r}</span>
                {c.r === null ? "—" : `${c.r > 0 ? "+" : c.r < 0 ? "−" : ""}${fmtNum(Math.abs(c.r), lang, 2)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
