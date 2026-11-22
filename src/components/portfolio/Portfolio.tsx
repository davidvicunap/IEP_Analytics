"use client";

// "Mi cartera" on the home page: what the user owns, each holding with one light and the reason
// for it (and the one action that fixes it), totals in US dollars and in the user's currency.
// With nothing owned yet: start by adding a position or importing the broker's file.
import Link from "next/link";
import { useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtDate, fmtNum } from "@/lib/format";
import { useFx } from "@/lib/fxClient";
import { CURRENCIES, fmtMoney, type Currency } from "@/lib/money";
import { byUrgency, holdingLight, holdingReasons, totals, type Light, type Reason } from "@/lib/portfolio";
import { useNotes, useTheses } from "@/lib/researchClient";
import { riskStore, useRisk } from "@/lib/riskClient";
import { useSnapshots } from "@/lib/snapshotClient";
import { useSymbolInfo } from "@/lib/symbolsClient";
import { useTrades } from "@/lib/tradesClient";
import { book, positions } from "@/lib/trades";
import { useQuotes } from "@/lib/useQuotes";
import AddPosition from "./AddPosition";
import ImportTrades from "./ImportTrades";
import { ChevronRightIcon } from "../icons";
import { Badge, IssueNote, Panel, Provenance, Skeleton, StatusMessage, buttonClass } from "../ui";

type Lang = "es" | "en";
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const TONE: Record<Light, "bad" | "warn" | "good" | "neutral"> = { red: "bad", amber: "warn", green: "good", gray: "neutral" };
const signedPct = (v: number, lang: Lang) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(v) * 100, lang, 1)}%`;
const signedUsd = (v: number, lang: Lang) => `${v > 0 ? "+" : ""}${fmtMoney(v, "USD", lang)}`;

// Adding the first holding also follows the stock, which switches the home page to its "following"
// layout and mounts this panel again: the confirmation is handed over to the new one.
let handover: string | null = null;
const takeHandover = () => {
  const h = handover;
  handover = null;
  return h;
};

export default function Portfolio() {
  const { t, lang } = useI18n();
  const P = t.portfolio;
  const { state, retry } = useTrades();
  const [mode, setMode] = useState<null | "add" | "import">(null);
  const [done, setDoneState] = useState<string | null>(takeHandover);
  const setDone = (msg: string) => {
    handover = msg;
    setDoneState(msg);
    // Only for the remount that follows right away, never for a later visit.
    setTimeout(() => {
      if (handover === msg) handover = null;
    }, 2000);
  };
  const trades = state.status === "ok" ? state.data : state.status === "loading" ? (state.previous?.data ?? null) : null;
  const info = useSymbolInfo(useMemo(() => [...new Set((trades ?? []).map((x) => x.symbol))], [trades]));
  const open = useMemo(() => positions(book(trades ?? [], info.splits).open), [trades, info.splits]);

  const actions = (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => setMode(mode === "add" ? null : "add")} aria-expanded={mode === "add"} className={buttonClass(open.length ? "secondary" : "primary", true)}>
        {P.add}
      </button>
      <button type="button" onClick={() => setMode(mode === "import" ? null : "import")} aria-expanded={mode === "import"} className={buttonClass("secondary", true)}>
        {P.import}
      </button>
    </div>
  );
  const forms =
    mode === "add" ? (
      <AddPosition
        onDone={(s) => {
          setMode(null);
          setDone(fill(P.added, { s }));
        }}
        onCancel={() => setMode(null)}
      />
    ) : mode === "import" ? (
      <ImportTrades
        onDone={(n) => {
          setMode(null);
          setDone(fill(P.imported, { n }));
        }}
        onCancel={() => setMode(null)}
      />
    ) : null;

  return (
    <Panel title={P.title} id="portfolio" action={open.length ? <CurrencyPicker /> : undefined}>
      <div className="space-y-4">
        {state.status === "error" ? (
          <IssueNote issue={state.issue} onRetry={retry} />
        ) : !trades ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : open.length === 0 ? (
          <>
            <p className="text-[15px]">{P.intro}</p>
            {actions}
            {forms}
            <p className="text-xs text-muted">{P.noInvest}</p>
          </>
        ) : (
          <>
            <Holdings open={open} info={info} />
            {actions}
            {forms}
          </>
        )}
        {done && <StatusMessage>{done}</StatusMessage>}
      </div>
    </Panel>
  );
}

function CurrencyPicker() {
  const { t } = useI18n();
  const risk = useRisk();
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      {t.portfolio.money}
      <select value={risk.currency} onChange={(e) => riskStore.write({ ...risk, currency: e.target.value as Currency })} className="h-11 rounded-lg border border-line bg-panel px-2 text-sm text-fg sm:h-8">
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

function Holdings({ open, info }: { open: ReturnType<typeof positions>; info: ReturnType<typeof useSymbolInfo> }) {
  const { t, lang } = useI18n();
  const P = t.portfolio;
  const symbols = open.map((p) => p.symbol);
  const q = useQuotes(symbols, { enabled: symbols.length > 0 });
  const notes = useNotes();
  const theses = useTheses();
  const snaps = useSnapshots(symbols);
  const risk = useRisk();
  const fx = useFx(risk.currency);
  const [today] = useState(localToday);

  const rows = open
    .map((p) => {
      const item = q.items.find((i) => i.symbol === p.symbol);
      const price = item?.quote?.price ?? null;
      const note = notes.state.status === "ok" ? notes.state.data.find((n) => n.symbol === p.symbol) : undefined;
      const thesis = theses.state.status === "ok" ? (theses.state.data.items.find((i) => i.symbol === p.symbol)?.status ?? null) : null;
      const snap = snaps.state[p.symbol];
      const filings = snap?.status === "ok" && snap.data.filings.ok ? snap.data.filings.data : null;
      const reasons = holdingReasons({
        position: p,
        price,
        stop: note?.closed ? null : (note?.stop ?? null),
        thesis,
        nextResults: filings?.nextResults?.date ?? null,
        lastReport: filings?.report ? { form: filings.report.form, filed: filings.report.filed } : null,
        listing: info.listing(p.symbol),
        today,
      });
      return { p, price, reasons, light: holdingLight(reasons), value: price === null ? 0 : p.shares * price };
    })
    .sort(byUrgency);
  const sum = totals(rows.map((r) => ({ position: r.p, price: r.price })));
  const asOf = q.items.map((i) => i.fetchedAt).filter((x): x is string => !!x).sort().at(-1);
  const pricedCost = sum.cost - rows.filter((r) => r.price === null).reduce((s, r) => s + r.p.cost, 0);

  return (
    <>
      <dl className="num grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl bg-panel-2 p-4 sm:grid-cols-3 sm:p-5" data-testid="portfolio-totals">
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-xs font-medium text-muted">{P.value}</dt>
          <dd className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.02em] sm:text-[30px]">{q.loading ? "…" : fmtMoney(sum.value, "USD", lang)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted">{P.gain}</dt>
          <dd className={`mt-1 text-lg font-semibold leading-snug ${q.loading ? "" : sum.gain > 0 ? "text-up" : sum.gain < 0 ? "text-down" : ""}`}>
            {q.loading ? (
              "…"
            ) : (
              <>
                {signedUsd(sum.gain, lang)} <span className="block whitespace-nowrap text-sm font-medium sm:inline">({pricedCost > 0 ? signedPct(sum.gain / pricedCost, lang) : "—"})</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted">{P.cost}</dt>
          <dd className="mt-1 text-lg font-semibold leading-snug">{fmtMoney(sum.cost, "USD", lang)}</dd>
        </div>
      </dl>
      {risk.currency !== "USD" &&
        (fx.state.status === "ok" ? (
          <p className="num -mt-2 text-xs text-muted" data-testid="portfolio-local">
            {fill(P.inLocal, { v: fmtMoney(sum.value * fx.state.data.perUsd, risk.currency, lang), r: fmtNum(fx.state.data.perUsd, lang, 2), c: risk.currency, src: P.fxSource[fx.state.data.source], t: fmtAsOf(fx.state.data.asOf, lang) })}
          </p>
        ) : fx.state.status === "error" ? (
          <p className="-mt-2 text-xs text-warn">{fill(P.fxFailed, { c: risk.currency })}</p>
        ) : null)}
      {sum.unpriced > 0 && <p className="-mt-2 text-xs text-muted">{fill(P.unpriced, { n: sum.unpriced })}</p>}
      <ul className="divide-y divide-line border-b border-line" data-testid="holdings">
        {rows.map(({ p, price, reasons, light }) => {
          const gain = price === null ? null : p.shares * price - p.cost;
          return (
            <li key={p.symbol} className="flex flex-col gap-1.5 py-3.5 sm:flex-row sm:items-start sm:gap-4" data-testid={`holding-${p.symbol}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/stock/${encodeURIComponent(p.symbol)}`} prefetch={false} className="inline-flex min-h-11 min-w-11 items-center font-semibold hover:underline sm:min-h-0 sm:min-w-0">
                    {p.symbol}
                  </Link>
                  <Badge tone={TONE[light]}>{P.light[light]}</Badge>
                </div>
                <p className="num text-xs text-muted">{fill(P.position, { n: fmtNum(p.shares, lang, 6), w: p.shares === 1 ? P.shareWord.one : P.shareWord.many, c: fmtMoney(p.avgPrice, "USD", lang) })}</p>
                {reasons[0] && <p className="mt-1 text-sm">{reasonText(reasons[0], P, lang)}</p>}
                <ReasonAction symbol={p.symbol} reason={reasons[0]} />
              </div>
              <div className="num text-sm sm:w-44 sm:text-right">
                <span className="block font-medium">{price === null ? "—" : fmtMoney(p.shares * price, "USD", lang)}</span>
                <span className={`block text-xs font-medium ${gain === null || gain === 0 ? "text-muted" : gain > 0 ? "text-up" : "text-down"}`}>{gain === null ? "" : `${signedUsd(gain, lang)} (${signedPct(gain / p.cost, lang)})`}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {q.source && <Provenance source={q.source} asOf={asOf} stale={q.items.some((i) => i.stale)} />}
    </>
  );
}

function reasonText(r: Reason, P: ReturnType<typeof useI18n>["t"]["portfolio"], lang: Lang): string {
  const R = P.reason;
  switch (r.kind) {
    case "delisted":
      return R.delisted;
    case "renamed":
      return fill(R.renamed, { to: r.to });
    case "noPrice":
      return R.noPrice;
    case "belowStop":
      return fill(R.belowStop, { s: fmtMoney(r.stop, "USD", lang) });
    case "atRisk":
      return R.atRisk;
    case "results":
      return r.days === 0 ? R.resultsToday : r.days === 1 ? R.resultsTomorrow : fill(R.resultsDays, { n: r.days, d: fmtDate(r.date, lang) });
    case "nearStop":
      return fill(R.nearStop, { p: `${fmtNum(r.gap * 100, lang, 1)}%`, s: fmtMoney(r.stop, "USD", lang) });
    case "report":
      return fill(R.report, { f: r.form, d: fmtDate(r.filed, lang) });
    case "noExit":
      return R.noExit;
    case "ok":
      return fill(R.ok, { s: fmtMoney(r.stop, "USD", lang), p: `${fmtNum(r.gap * 100, lang, 1)}%` });
  }
}

/** The one thing to do about the headline reason, when there is one. */
function ReasonAction({ symbol, reason }: { symbol: string; reason: Reason | undefined }) {
  const { t } = useI18n();
  const P = t.portfolio;
  const s = encodeURIComponent(symbol);
  if (!reason) return null;
  const link = (href: string, text: string) => (
    <Link href={href} prefetch={false} className="mt-0.5 inline-flex min-h-11 items-center gap-0.5 text-sm font-medium text-accent hover:underline sm:min-h-0">
      {text}
      <ChevronRightIcon size={14} />
    </Link>
  );
  if (reason.kind === "noExit") return link(`/stock/${s}?tab=research&plan=1`, P.setExit);
  if (reason.kind === "atRisk" || reason.kind === "belowStop") return link(`/stock/${s}?tab=research`, P.seeAlert);
  if (reason.kind === "report") return link(`/stock/${s}?tab=filings`, P.seeReport);
  if (reason.kind === "renamed") return link(`/stock/${s}?tab=research#listing`, fill(P.move, { to: reason.to }));
  return null;
}
