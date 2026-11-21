"use client";

// Importing a broker's CSV: read in the browser (nothing leaves it until the user confirms), a
// plain summary of what was found, skipped and unreadable, the date order when it's ambiguous,
// a preview, and one all-or-nothing import. Imported stocks are followed.
import { useId, useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtDate, fmtNum } from "@/lib/format";
import { fmtMoney } from "@/lib/money";
import { parseBrokerCsv, type CsvResult, type DateOrder } from "@/lib/brokerCsv";
import { importTrades } from "@/lib/tradesClient";
import { useWatchlist } from "@/lib/watchlist";
import { StatusMessage, buttonClass } from "../ui";

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const PREVIEW = 8;

export default function ImportTrades({ onDone, onCancel }: { onDone: (n: number) => void; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const P = t.portfolio;
  const id = useId();
  const { add } = useWatchlist();
  const [text, setText] = useState("");
  const [read, setRead] = useState<string | null>(null);
  const [order, setOrder] = useState<DateOrder | undefined>(undefined);
  const [holdingsDate, setHoldingsDate] = useState(localToday);
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "error"; text: string }>({ kind: "idle" });
  const result: CsvResult | null = useMemo(() => (read === null ? null : parseBrokerCsv(read, localToday(), { order, holdingsDate })), [read, order, holdingsDate]);
  const ok = result ? result.rows.flatMap((r) => (r.ok ? [r.trade] : [])) : [];
  const skipped = result ? result.rows.filter((r) => !r.ok && r.reason === "notTrade").length : 0;
  const bad = result ? result.rows.flatMap((r) => (!r.ok && r.reason !== "notTrade" ? [r] : [])) : [];

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    setText(content);
    setOrder(undefined);
    setRead(content);
  };
  const confirm = async () => {
    if (!ok.length) return;
    setStatus({ kind: "saving" });
    const r = await importTrades(ok);
    if (!r.ok) {
      const text =
        r.error === "oversold" && r.first ? fill(P.oversold, { s: r.first.symbol, d: fmtDate(r.first.date, lang) }) : r.error === "invalid" ? P.invalid : r.error === "beta_expired" ? t.data.betaExpired : P.failed;
      return setStatus({ kind: "error", text });
    }
    for (const s of new Set(ok.map((x) => x.symbol))) add(s);
    onDone(r.data.imported);
  };
  const other = (o: DateOrder): DateOrder => (o === "dmy" ? "mdy" : "dmy");

  return (
    <section className="space-y-3 rounded-xl border border-line p-4" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-sm font-semibold">
        {P.importTitle}
      </h3>
      <p className="text-xs text-muted">{P.importIntro}</p>
      <div>
        <label htmlFor={`${id}-file`} className="control-label mb-1.5 block">
          {P.file}
        </label>
        <input id={`${id}-file`} type="file" accept=".csv,text/csv,text/plain" onChange={(e) => onFile(e.target.files?.[0])} className="block w-full text-sm file:mr-3 file:h-11 file:rounded-lg file:border file:border-line file:bg-panel file:px-3 sm:file:h-9" />
      </div>
      <div>
        <label htmlFor={`${id}-paste`} className="control-label mb-1.5 block">
          {P.paste}
        </label>
        <textarea id={`${id}-paste`} value={text} onChange={(e) => setText(e.target.value)} rows={4} className="w-full rounded-lg border border-line bg-panel px-3 py-2 font-mono text-xs" spellCheck={false} />
        <button
          type="button"
          onClick={() => {
            setOrder(undefined);
            setRead(text);
          }}
          disabled={!text.trim()}
          className={`${buttonClass("secondary", true)} mt-2`}
        >
          {P.read}
        </button>
      </div>

      {result && (
        <div className="space-y-2 text-sm" data-testid="import-summary" aria-live="polite">
          {result.missing.length > 0 ? (
            <StatusMessage tone="warn">{fill(P.missing, { list: result.missing.map((f) => P.fieldNames[f]).join(", ") })}</StatusMessage>
          ) : ok.length === 0 ? (
            <StatusMessage tone="warn">{P.nothing}</StatusMessage>
          ) : result.kind === "holdings" ? (
            <>
              <p className="font-medium">{fill(P.foundHoldings, { n: ok.length })}</p>
              <label className="control-label block" htmlFor={`${id}-hdate`}>
                {P.holdingsDate}
              </label>
              <input id={`${id}-hdate`} type="date" value={holdingsDate} max={localToday()} onChange={(e) => setHoldingsDate(e.target.value || localToday())} className="h-11 rounded-lg border border-line bg-panel px-3 text-sm sm:h-9" />
            </>
          ) : (
            <p className="font-medium">
              {fill(P.found, { n: ok.length, b: ok.filter((x) => x.side === "buy").length, s: ok.filter((x) => x.side === "sell").length, k: new Set(ok.map((x) => x.symbol)).size })}
            </p>
          )}
          {result.dateOrder && result.dateOrder !== "ymd" && ok.length > 0 && (
            <p className="text-xs text-muted">
              {fill(P.dates, { o: P.orders[result.dateOrder] })}{" "}
              {(result.dateAmbiguous || order) && (
                <button type="button" className="link inline-flex min-h-11 items-center sm:min-h-0" onClick={() => setOrder(other(result.dateOrder!))}>
                  {fill(P.swap, { o: P.orders[other(result.dateOrder)] })}
                </button>
              )}
            </p>
          )}
          {skipped > 0 && <p className="text-xs text-muted">{skipped === 1 ? P.skippedOne : fill(P.skipped, { n: skipped })}</p>}
          {bad.length > 0 && (
            <p className="text-xs text-warn">
              {fill(P.problems, { n: bad.length })} {bad.slice(0, 6).map((b) => fill(P.problem[b.reason], { l: b.line })).join(" · ")}
              {bad.length > 6 ? " …" : ""}
            </p>
          )}
          {ok.length > 0 && (
            <>
              <p className="text-xs text-muted">{P.preview}</p>
              <ul className="num divide-y divide-line border-y border-line text-xs">
                {ok.slice(0, PREVIEW).map((x, i) => (
                  <li key={i} className="flex flex-wrap gap-x-3 py-1.5">
                    <span className="w-24 text-muted">{fmtDate(x.date, lang)}</span>
                    <span className="w-14">{P.side[x.side]}</span>
                    <span className="w-14 font-semibold">{x.symbol}</span>
                    <span>
                      {fmtNum(x.shares, lang, 6)} × {fmtMoney(x.price, "USD", lang)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {status.kind === "error" && <StatusMessage tone="warn">{status.text}</StatusMessage>}
      <div className="flex flex-wrap gap-2">
        {ok.length > 0 && !result?.missing.length && (
          <button type="button" onClick={confirm} disabled={status.kind === "saving"} className={buttonClass("primary", true)}>
            {status.kind === "saving" ? P.importing : fill(P.confirm, { n: ok.length })}
          </button>
        )}
        <button type="button" onClick={onCancel} className={buttonClass("secondary", true)}>
          {P.cancel}
        </button>
      </div>
    </section>
  );
}
