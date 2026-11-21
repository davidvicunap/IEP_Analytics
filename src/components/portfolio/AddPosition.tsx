"use client";

// Adding one holding: pick the company from the search list (so the ticker is real), how many
// shares, the average price and roughly when. It's logged as a buy, and the stock is followed.
import { useId, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtPrice } from "@/lib/format";
import { addTrade } from "@/lib/tradesClient";
import { useQuotes } from "@/lib/useQuotes";
import { useWatchlist } from "@/lib/watchlist";
import TickerSearch from "../TickerSearch";
import { StatusMessage, buttonClass } from "../ui";
import { NumberField } from "../valuation/fields";

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function AddPosition({ onDone, onCancel }: { onDone: (symbol: string) => void; onCancel: () => void }) {
  const { t, lang } = useI18n();
  const P = t.portfolio;
  const T = t.trades;
  const dateId = useId();
  const { add } = useWatchlist();
  const [symbol, setSymbol] = useState<string | null>(null);
  const [shares, setShares] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [date, setDate] = useState(localToday);
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "error"; text: string }>({ kind: "idle" });
  const q = useQuotes(symbol ? [symbol] : [], { enabled: !!symbol });
  const current = symbol ? (q.items[0]?.quote?.price ?? null) : null;

  const save = async () => {
    if (!symbol) return setStatus({ kind: "error", text: P.pickFirst });
    if (!shares || !price) return setStatus({ kind: "error", text: T.invalid });
    setStatus({ kind: "saving" });
    const r = await addTrade(symbol, { side: "buy", date, shares, price, fees: 0, stop: null, note: "" });
    if (!r.ok) return setStatus({ kind: "error", text: r.error === "invalid" ? T.invalid : r.error === "beta_expired" ? t.data.betaExpired : T.failed });
    add(symbol); // you follow what you own
    onDone(symbol);
  };

  return (
    <form
      className="space-y-3 rounded-xl border border-line p-4"
      aria-labelledby={`${dateId}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h3 id={`${dateId}-title`} className="text-sm font-semibold">
        {P.addTitle}
      </h3>
      {symbol ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{fill(P.picked, { s: symbol })}</span>
          <button type="button" className="link inline-flex min-h-11 items-center sm:min-h-0" onClick={() => setSymbol(null)}>
            {P.change}
          </button>
        </p>
      ) : (
        <div>
          <p className="control-label mb-1.5">{P.company}</p>
          <TickerSearch onSelect={setSymbol} label={P.company} />
          <p className="mt-1 text-xs text-muted">{P.companyHint}</p>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <NumberField label={P.shares} value={shares} onChange={setShares} digits={6} className="w-28" />
        <NumberField label={P.price} value={price} onChange={setPrice} className="w-44" />
        <div>
          <label htmlFor={dateId} className="control-label mb-1.5 block">
            {P.date}
          </label>
          <input id={dateId} type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} className="h-11 rounded-lg border border-line bg-panel px-3 text-sm sm:h-9" />
        </div>
      </div>
      {current !== null && price !== Math.round(current * 100) / 100 && (
        <button type="button" className="link inline-flex min-h-11 items-center text-xs sm:min-h-0" onClick={() => setPrice(Math.round(current * 100) / 100)}>
          {fill(P.usePrice, { p: fmtPrice(current, lang) })}
        </button>
      )}
      {status.kind === "error" && <StatusMessage tone="warn">{status.text}</StatusMessage>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={status.kind === "saving"} className={buttonClass("primary", true)}>
          {status.kind === "saving" ? P.saving : P.save}
        </button>
        <button type="button" onClick={onCancel} className={buttonClass("secondary", true)}>
          {P.cancel}
        </button>
      </div>
    </form>
  );
}
