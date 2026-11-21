"use client";

// "My trades in X" on the stock's research tab: the open position at today's price, the trades
// logged for this stock and a form to log a buy or a sell (a buy keeps the thesis stop, so the
// result can be measured in R). Text: `trades` in the deep dictionary.
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { positionSize } from "@/lib/planBuilder";
import type { ResearchNote } from "@/lib/research";
import { useRisk } from "@/lib/riskClient";
import { capitalInUsd, useFx } from "@/lib/fxClient";
import { useSymbolInfo } from "@/lib/symbolsClient";
import { addTrade, removeTrade, useTrades, type TradeIssue } from "@/lib/tradesClient";
import { book, positions, type Side } from "@/lib/trades";
import { TrashIcon } from "../icons";
import { IssueNote, Panel, Segmented, Skeleton, StatusMessage, buttonClass } from "../ui";
import { NumberField } from "../valuation/fields";

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const cents = (v: number) => Math.round(v * 100) / 100;

export default function TradesPanel({ symbol, price, note }: { symbol: string; price: number | null; note: ResearchNote }) {
  const { t, lang } = useI18n();
  const T = t.trades;
  const { state, retry } = useTrades();
  const risk = useRisk();
  const dateId = useId();
  const [side, setSide] = useState<Side>("buy");
  const [date, setDate] = useState(localToday);
  const [shares, setShares] = useState<number | null>(null);
  const [px, setPx] = useState<number | null>(price ? cents(price) : null);
  const [fees, setFees] = useState<number | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; issue: TradeIssue; deleting?: boolean }>({ kind: "idle" });

  const all = state.status === "ok" ? state.data : state.status === "loading" ? state.previous?.data : undefined;
  const mine = useMemo(() => (all ?? []).filter((x) => x.symbol === symbol), [all, symbol]);
  const info = useSymbolInfo([symbol]);
  const position = useMemo(() => positions(book(mine, info.splits).open)[0] ?? null, [mine, info.splits]);
  const fx = useFx(risk.currency);
  const sized = positionSize({ account: capitalInUsd(risk, fx.state).usd, pct: risk.pct, entry: note.entry ?? price, stop: note.stop, target: note.target, direction: note.direction, fractions: risk.fractions });
  const word = (n: number) => (n === 1 ? T.shareWord.one : T.shareWord.many);

  const submit = async () => {
    // A sell may be at $0 (a delisting); a buy needs a price.
    if (!shares || px === null || px < 0 || (side === "buy" && px === 0) || status.kind === "saving") {
      setStatus({ kind: "error", issue: "invalid" });
      return;
    }
    setStatus({ kind: "saving" });
    const r = await addTrade(symbol, { side, date, shares, price: px, fees: fees ?? 0, stop: side === "buy" ? note.stop : null, note: "" });
    if (r.ok) {
      setStatus({ kind: "saved" });
      setShares(null);
      setFees(null);
    } else setStatus({ kind: "error", issue: r.error });
  };
  const remove = async (id: string) => {
    const r = await removeTrade(id);
    setStatus(r.ok ? { kind: "idle" } : { kind: "error", issue: r.error, deleting: true });
  };

  const errorText = (s: Extract<typeof status, { kind: "error" }>) =>
    s.issue === "oversold" ? (s.deleting ? T.dependsOn : T.oversold) : s.issue === "invalid" ? T.invalid : s.issue === "beta_expired" ? t.data.betaExpired : T.failed;

  return (
    <Panel title={fill(T.panelTitle, { s: symbol })} description={T.panelIntro} id="trades">
      {state.status === "error" ? (
        <IssueNote issue={state.issue} onRetry={retry} />
      ) : !all ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : (
        <div className="space-y-5">
          <div className="num text-sm" data-testid="position">
            {position ? (
              <>
                <p className="font-medium">{fill(T.position, { n: fmtNum(position.shares, lang, 6), w: word(position.shares), c: fmtPrice(position.avgPrice, lang) })}</p>
                {price !== null && (
                  <p className="text-muted">
                    {(() => {
                      const value = position.shares * price;
                      const gain = value - position.cost;
                      return fill(T.positionValue, { p: fmtPrice(price, lang), v: fmtPrice(value, lang), g: `${gain >= 0 ? "+" : "−"}${fmtPrice(Math.abs(gain), lang)}`, gp: `${gain >= 0 ? "+" : "−"}${fmtNum(Math.abs(gain / position.cost) * 100, lang, 1)}%` });
                    })()}
                  </p>
                )}
              </>
            ) : (
              <p className="text-muted">{fill(T.positionNone, { s: symbol })}</p>
            )}
          </div>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <p className="control-label mb-1.5">{T.sideLabel}</p>
                <Segmented label={T.sideLabel} value={side} onChange={setSide} options={(["buy", "sell"] as const).map((s) => ({ value: s, label: T.side[s] }))} />
              </div>
              <div>
                <label htmlFor={dateId} className="control-label mb-1.5 block">
                  {T.date}
                </label>
                <input id={dateId} type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} className="h-11 rounded-lg border border-line bg-panel px-3 text-sm sm:h-9" />
              </div>
              <NumberField label={T.shares} value={shares} onChange={setShares} digits={6} className="w-28" />
              <NumberField label={T.price} value={px} onChange={setPx} suffix="$" className="w-32" />
              <NumberField label={T.fees} value={fees} onChange={setFees} suffix="$" className="w-24" />
              <button type="submit" disabled={status.kind === "saving"} className={buttonClass("primary", true)}>
                {status.kind === "saving" ? T.adding : T.add}
              </button>
            </div>
            <div className="flex flex-wrap gap-x-4 text-xs">
              {side === "buy" && sized && sized.shares > 0 && shares !== sized.shares && (
                <button type="button" className="link inline-flex min-h-11 items-center sm:min-h-0" onClick={() => setShares(sized.shares)}>
                  {fill(T.sized, { n: fmtNum(sized.shares, lang, 3) })}
                </button>
              )}
              {price !== null && px !== cents(price) && (
                <button type="button" className="link inline-flex min-h-11 items-center sm:min-h-0" onClick={() => setPx(cents(price))}>
                  {fill(T.usePrice, { p: fmtPrice(price, lang) })}
                </button>
              )}
            </div>
            {side === "buy" && note.stop !== null && <p className="text-xs text-muted">{fill(T.stopNote, { v: fmtPrice(note.stop, lang) })}</p>}
            <p className="text-xs text-muted">{T.longOnly}</p>
            {status.kind === "saved" && <StatusMessage>{T.added}</StatusMessage>}
            {status.kind === "error" && <StatusMessage tone="warn">{errorText(status)}</StatusMessage>}
          </form>

          <div>
            <h3 className="mb-1 text-sm font-medium">{T.history}</h3>
            {mine.length === 0 ? (
              <p className="text-sm text-muted">{fill(T.noTrades, { s: symbol })}</p>
            ) : (
              <ul className="divide-y divide-line border-y border-line" data-testid="trade-list">
                {[...mine].reverse().map((x) => (
                  <li key={x.id} className="num flex items-center gap-3 py-2 text-sm">
                    <span className="w-24 shrink-0 text-xs text-muted">{fmtDate(x.date, lang)}</span>
                    <span className="w-16 shrink-0 font-medium">{T.side[x.side]}</span>
                    <span className="min-w-0 flex-1">
                      {fmtNum(x.shares, lang, 6)} × {fmtPrice(x.price, lang)}
                      {x.fees > 0 && <span className="text-xs text-muted"> · {T.fees.toLowerCase()} {fmtPrice(x.fees, lang)}</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(x.id)}
                      className="-my-2.5 grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted hover:bg-panel-2 hover:text-fg sm:-my-1.5 sm:h-9 sm:w-9"
                      aria-label={fill(T.delete, { d: fmtDate(x.date, lang) })}
                    >
                      <TrashIcon size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-sm">
              <Link href="/research/results" prefetch={false} className="link">
                {T.seeRecord}
              </Link>
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}
