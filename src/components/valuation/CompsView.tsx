"use client";

import { useContext, useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtBig, fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { MIN_PEERS, compsRow, impliedValues, peerStats, type CompsMultiple, type CompsRow } from "@/lib/comps";
import type { CompsPayload } from "@/lib/compsData";
import type { MarketCap } from "@/lib/marketCap";
import { shown as shownData } from "@/lib/resource";
import { useResource } from "@/lib/useResource";
import { InWindow, IssueNote, Panel, Skeleton, SourceNote, buttonClass } from "../ui";
import { NumberField } from "./fields";

type Lang = "es" | "en";
const MAX = 15;
const money = (v: number | null) => (v === null ? "—" : v < 0 ? `−$${fmtBig(-v)}` : `$${fmtBig(v)}`);
const pct = (v: number | null, lang: Lang) => (v === null ? "—" : `${fmtNum(v * 100, lang, 1)}%`);
const mult = (m: CompsMultiple, v: number | null, lang: Lang) =>
  v === null ? "—" : m === "fcfYield" ? pct(v, lang) : `${fmtNum(v, lang, 1)}x`;
const signed = (v: number | null, lang: Lang) => (v === null ? "—" : `${v >= 0 ? "+" : "−"}${fmtNum(Math.abs(v) * 100, lang, 0)}%`);

// Per-viewer conveniences only (never shared, never required).
const store = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode or blocked storage: the screen still works */
    }
  },
};

/**
 * Comparable companies: the same fiscal year of SEC figures for everyone, market values from
 * SEC share counts × price, a median only where at least MIN_PEERS peers have the figure, and
 * implied values only from those medians.
 */
export default function CompsView({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const peersKey = `iep:comps:peers:${symbol}`;
  const manualKey = `iep:comps:manual:${symbol}`;
  const [peers, setPeers] = useState<string[] | null>(() => store.get<string[]>(peersKey));
  const [manual, setManual] = useState<Record<string, number>>(() => store.get<Record<string, number>>(manualKey) ?? {});
  const [draft, setDraft] = useState("");

  const qs = new URLSearchParams({ symbol });
  if (peers) qs.set("peers", peers.join(","));
  const { state, retry } = useResource<CompsPayload>(`/api/valuation/comps?${qs}`, { keepPrevious: true });
  const onScreen = shownData(state); // the last answer stays while new peers load
  const updating = state.status === "loading" && onScreen !== null;

  const updatePeers = (next: string[] | null) => {
    setPeers(next);
    store.set(peersKey, next);
  };
  const updateManual = (s: string, v: number | null) => {
    setManual((m) => {
      const next = { ...m };
      if (v === null || !(v > 0)) delete next[s];
      else next[s] = v;
      store.set(manualKey, Object.keys(next).length ? next : null);
      return next;
    });
  };

  const view = useMemo(() => {
    if (!onScreen) return null;
    const d = onScreen.data;
    const target = compsRow({ ...d.target, marketCapSource: d.target.marketCap ? "sec" : null });
    const rows: CompsRow[] = d.peers.map((p) => {
      const typed = manual[p.symbol];
      const marketCap = p.marketCap ?? (typed ? typed : null);
      return compsRow({ ...p, marketCap, marketCapSource: p.marketCap ? "sec" : typed ? "manual" : null });
    });
    const basis = new Map<string, MarketCap | null>([[d.target.symbol, d.target.marketCapBasis], ...d.peers.map((p) => [p.symbol, p.marketCapBasis] as const)]);
    return { d, target, rows, basis };
  }, [onScreen, manual]);

  if (state.status === "loading" && !onScreen) {
    return (
      <div className="space-y-3">
        <p role="status" className="text-sm text-muted">{t.comps.loading}</p>
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (state.status === "error" || !view) {
    return (
      <Panel title={t.comps.title}>
        <IssueNote issue={state.status === "error" ? state.issue : "upstream"} onRetry={retry} />
      </Panel>
    );
  }

  const { d, target, rows, basis } = view;
  const financial = d.target.businessType === "bank" || d.target.businessType === "insurance";
  const shown: CompsMultiple[] = financial ? ["pe", "pb"] : ["evSales", "evEbitda", "pe", "pb", "fcfYield"];
  const current = d.peers.map((p) => p.symbol);
  const add = () => {
    const s = draft.trim().toUpperCase();
    if (!s || current.includes(s) || s === d.target.symbol) return setDraft("");
    if (current.length >= MAX) return;
    updatePeers([...current, s]);
    setDraft("");
  };
  const implied = impliedValues(target, rows, d.target.price).filter((v) => shown.includes(v.multiple));
  const diluted = [...basis.values()].some((b) => b?.sharesSource === "diluted");

  return (
    <div className={`space-y-5 transition-opacity ${updating ? "opacity-60" : ""}`} aria-busy={updating}>
      <div className="max-w-[72ch] space-y-1">
        <h2 className="section-title">{t.comps.title}</h2>
        <p className="text-sm leading-relaxed">{fill(t.comps.basis, { year: d.year })}</p>
        <p className="text-[13px] text-muted">{d.suggested ? t.comps.suggested : t.comps.custom}</p>
      </div>

      <div>
        <ul className="flex flex-wrap gap-2" aria-label={t.comps.title}>
          {current.map((s) => (
            <li key={s} className="inline-flex h-9 items-center gap-1 rounded-full border border-line bg-panel pl-3 pr-1 text-sm">
              <span className="font-medium">{s}</span>
              <button
                type="button"
                onClick={() => updatePeers(current.filter((x) => x !== s))}
                aria-label={fill(t.comps.remove, { s })}
                className="grid h-11 w-11 place-items-center rounded-full text-muted hover:bg-panel-2 hover:text-fg sm:h-7 sm:w-7"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="comps-add" className="control-label">{t.comps.addLabel}</label>
            <input
              id="comps-add"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t.comps.addPlaceholder}
              autoComplete="off"
              className="h-11 sm:h-9 w-44 rounded-lg border border-line bg-panel px-3 text-sm uppercase placeholder:normal-case placeholder:text-muted"
            />
          </div>
          <button type="submit" disabled={current.length >= MAX} className={buttonClass("secondary", true)}>
            {t.comps.add}
          </button>
          {!d.suggested && (
            <button type="button" onClick={() => updatePeers(null)} className={buttonClass("ghost", true)}>
              {t.comps.resetPeers}
            </button>
          )}
        </form>
        {current.length >= MAX && <p className="mt-2 text-xs text-muted">{fill(t.comps.maxPeers, { n: MAX })}</p>}
        {d.unknown.length > 0 && <p className="mt-2 text-xs text-warn">{fill(t.comps.unknown, { list: d.unknown.join(", ") })}</p>}
      </div>

      <Panel bare>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">{t.comps.noPeers}</p>
        ) : (
          // Peers with a market value (the SEC's shares × a price, or one you typed); the rest below.
          <CompsTable target={target} rows={rows.filter((r) => r.marketCap !== null)} shown={shown} basis={basis} lang={lang} />
        )}
        <Unpriced symbols={d.unpriced} rows={rows} manual={manual} issue={d.marketCapsIssue} onManual={updateManual} />
        <div className="mt-3 space-y-1 text-xs text-muted">
          <p>{fill(t.comps.fewPeers, { min: MIN_PEERS })}</p>
          {diluted && <p>{t.comps.dilutedNote}</p>}
          {financial && <p>{t.comps.bankNote}</p>}
        </div>
      </Panel>

      <section aria-labelledby="comps-implied">
        <h3 id="comps-implied" className="section-title">{t.comps.impliedTitle}</h3>
        <p className="mt-1 mb-3 max-w-[72ch] text-[13px] text-muted">
          {fill(t.comps.impliedIntro, { price: fmtPrice(d.target.price, lang), min: MIN_PEERS })}
        </p>
        {implied.length === 0 ? (
          <p className="text-sm text-muted">{fill(t.comps.noImplied, { min: MIN_PEERS })}</p>
        ) : (
          <Panel>
            <FootballField ranges={implied} price={d.target.price} lang={lang} />
          </Panel>
        )}
      </section>

      <SourceNote source={t.comps.sources} asOf={onScreen?.fetchedAt} how={<p>{t.comps.formulas}</p>} />
    </div>
  );
}

/**
 * Peers without a price today, named in one line instead of a row of empty boxes; a market value
 * from another source can be typed for each (kept in this browser, marked as yours in the table).
 */
function Unpriced({
  symbols,
  rows,
  manual,
  issue,
  onManual,
}: {
  symbols: string[];
  rows: CompsRow[];
  manual: Record<string, number>;
  issue: CompsPayload["marketCapsIssue"];
  onManual: (s: string, v: number | null) => void;
}) {
  const { t } = useI18n();
  if (symbols.length === 0) return null;
  const missing = symbols.filter((s) => !(manual[s] > 0));
  const nameOf = (s: string) => rows.find((r) => r.symbol === s)?.name ?? s;
  return (
    <div className="mt-3 border-t border-line pt-3 text-[13px]" data-testid="comps-unpriced">
      {missing.length > 0 && (
        <p className="text-muted">{fill(missing.length === 1 ? t.comps.unpricedOne : t.comps.unpriced, { n: missing.length, list: missing.join(", ") })}</p>
      )}
      {issue && missing.length > 0 && <IssueNote issue={issue} className="mt-1" />}
      <details className="mt-2">
        <summary className="link inline-flex min-h-11 cursor-pointer items-center sm:min-h-0">{t.comps.typeValues}</summary>
        <p className="mt-2 max-w-[64ch] text-xs text-muted">{t.comps.typeIntro}</p>
        <ul className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {symbols.map((s) => (
            <li key={s} className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="font-medium">{s}</span>
                <span className="block truncate text-[11px] text-muted">{nameOf(s)}</span>
              </span>
              <div className="w-28 shrink-0">
                <NumberField
                  label={fill(t.comps.manualLabel, { s })}
                  srLabel
                  value={manual[s] ?? null}
                  scale={1e-9}
                  digits={1}
                  placeholder={t.comps.manualPlaceholder}
                  onChange={(v) => onManual(s, v)}
                />
              </div>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function CompsTable({
  target,
  rows,
  shown,
  basis,
  lang,
}: {
  target: CompsRow;
  rows: CompsRow[];
  shown: CompsMultiple[];
  basis: Map<string, MarketCap | null>;
  lang: Lang;
}) {
  const { t } = useI18n();
  const cols = t.comps.cols;
  const ev = !shown.every((m) => m === "pe" || m === "pb");
  const stats = new Map(shown.map((m) => [m, peerStats(rows, m)] as const));
  const median = (m: CompsMultiple) => {
    const s = stats.get(m);
    return s && s.n >= MIN_PEERS ? s.median : null;
  };
  // The pinned column takes the surface it sits on: the page, or a canvas window.
  const surface = useContext(InWindow) ? "bg-panel" : "bg-bg";
  const sticky = "sticky left-0 z-10 text-left font-sans pl-4 pr-3 sm:pl-0";
  const capTitle = (b: MarketCap | null | undefined) =>
    b
      ? fill(t.comps.capTitle, {
          shares: fmtBig(b.shares),
          source: b.sharesSource === "cover" ? t.comps.sourceCover : t.comps.sourceDiluted,
          date: b.sharesSource === "cover" ? fmtDate(b.sharesAsOf, lang) : b.sharesAsOf,
          price: fmtPrice(b.price, lang),
          priceDate: fmtDate(b.priceAt, lang),
        })
      : undefined;

  const line = (r: CompsRow, isTarget: boolean) => {
    const b = basis.get(r.symbol);
    return (
      <tr key={r.symbol} className={isTarget ? "bg-panel-2" : ""}>
        <th scope="row" className={`${sticky} border-t border-line py-2 ${isTarget ? "bg-panel-2" : surface}`}>
          <span className="font-medium">{r.symbol}</span>
          {isTarget && <span className="ml-1 text-[11px] text-muted">({t.comps.thisCompany})</span>}
          <span className="block w-36 truncate text-[11px] font-normal text-muted" title={r.name}>{r.name}</span>
          {!r.inputs && <span className="block text-[11px] font-normal text-warn">{t.comps.noData}</span>}
        </th>
        <td className="border-t border-line px-2 py-2 text-right align-top">
          {isTarget || r.marketCapSource === "sec" ? (
            <span title={capTitle(b)} className={b ? "cursor-help underline decoration-line-strong decoration-dotted underline-offset-4" : ""}>
              {money(r.marketCap)}
              {b?.sharesSource === "diluted" && <span className="text-muted">*</span>}
            </span>
          ) : (
            <>
              {money(r.marketCap)}
              <span className="block text-[11px] text-muted">{t.comps.manual}</span>
            </>
          )}
        </td>
        {ev && <td className="border-t border-line px-2 py-2 text-right align-top">{money(r.ev)}</td>}
        {shown.map((m) => (
          <td key={m} className="border-t border-line px-2 py-2 text-right align-top">{mult(m, r.multiples[m], lang)}</td>
        ))}
        <td className="border-t border-line px-2 py-2 text-right align-top">{pct(r.growth, lang)}</td>
        <td className="border-t border-line py-2 pr-4 text-right align-top sm:pr-0">{pct(r.operatingMargin, lang)}</td>
      </tr>
    );
  };

  const summary = (label: string, cell: (m: CompsMultiple) => React.ReactNode, first = false) => (
    <tr className={first ? "font-semibold" : "text-muted"}>
      <th scope="row" className={`${sticky} ${surface} py-2 font-medium ${first ? "border-t border-line-strong" : "border-t border-line"}`}>{label}</th>
      <td className={first ? "border-t border-line-strong" : "border-t border-line"} />
      {ev && <td className={first ? "border-t border-line-strong" : "border-t border-line"} />}
      {shown.map((m) => (
        <td key={m} className={`px-2 py-2 text-right ${first ? "border-t border-line-strong" : "border-t border-line"}`}>{cell(m)}</td>
      ))}
      <td className={first ? "border-t border-line-strong" : "border-t border-line"} />
      <td className={`pr-4 sm:pr-0 ${first ? "border-t border-line-strong" : "border-t border-line"}`} />
    </tr>
  );

  return (
    <div className="relative -mx-4 overflow-x-auto sm:mx-0" tabIndex={0} role="region" aria-label={t.comps.title}>
      <table className="num w-max min-w-full border-separate border-spacing-0 text-[13px]">
        <caption className="sr-only">{t.comps.title}</caption>
        <thead>
          <tr className="text-xs text-muted">
            <th scope="col" className={`${sticky} ${surface} pb-2 font-normal`}>{cols.company}</th>
            <th scope="col" className="px-2 pb-2 text-right font-normal">{cols.marketCap}</th>
            {ev && <th scope="col" className="px-2 pb-2 text-right font-normal">{cols.ev}</th>}
            {shown.map((m) => (
              <th key={m} scope="col" className="px-2 pb-2 text-right font-normal">{cols[m]}</th>
            ))}
            <th scope="col" className="px-2 pb-2 text-right font-normal">{cols.growth}</th>
            <th scope="col" className="pb-2 pr-4 text-right font-normal sm:pr-0">{cols.opMargin}</th>
          </tr>
        </thead>
        <tbody>
          {line(target, true)}
          {rows.map((r) => line(r, false))}
          {summary(t.comps.medianRow, (m) => mult(m, median(m), lang), true)}
          {summary(t.comps.countRow, (m) => String(stats.get(m)?.n ?? 0))}
          {summary(t.comps.vsMedian, (m) => {
            const own = target.multiples[m];
            const med = median(m);
            return own !== null && med ? signed(own / med - 1, lang) : "—";
          })}
        </tbody>
      </table>
    </div>
  );
}

function FootballField({ ranges, price, lang }: { ranges: ReturnType<typeof impliedValues>; price: number; lang: Lang }) {
  const { t } = useI18n();
  const lo = Math.min(price, ...ranges.map((r) => r.low)) * 0.9;
  const hi = Math.max(price, ...ranges.map((r) => r.high)) * 1.05;
  const x = (v: number) => `${((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="relative -mx-4 overflow-x-auto" tabIndex={0} role="region" aria-label={t.comps.impliedTitle}>
      <table className="num w-full min-w-[36rem] text-sm">
        <caption className="sr-only">{t.comps.impliedTitle}</caption>
        <thead>
          <tr className="text-xs text-muted">
            <th scope="col" className="py-1 pl-4 text-left font-normal">{t.comps.impliedCols.multiple}</th>
            <th scope="col" className="w-2/5"><span className="sr-only">{t.comps.impliedTitle}</span></th>
            <th scope="col" className="px-2 text-right font-normal">{t.comps.impliedCols.low}</th>
            <th scope="col" className="px-2 text-right font-normal">{t.comps.impliedCols.mid}</th>
            <th scope="col" className="pr-4 text-right font-normal">{t.comps.impliedCols.high}</th>
          </tr>
        </thead>
        <tbody>
          {ranges.map((r) => {
            // A range under 1 % wide is a point, not a spread: show the mark alone.
            const flat = r.high - r.low < Math.abs(r.mid) * 0.01;
            return (
              <tr key={r.multiple} className="border-t border-line">
                <th scope="row" className="py-2 pl-4 text-left font-sans font-medium">{t.comps.cols[r.multiple]}</th>
                <td className="px-2">
                  <div className="relative h-4" aria-hidden="true">
                    <div className="absolute left-0 right-0 top-1.5 h-1 rounded bg-panel-2" />
                    {!flat && <div className="absolute top-0.5 h-3 rounded bg-series-1/35" style={{ left: x(r.low), width: `calc(${x(r.high)} - ${x(r.low)})` }} />}
                    <div className="absolute top-0 h-4 w-1 rounded bg-series-1" style={{ left: `calc(${x(r.mid)} - 2px)` }} />
                    <div className="absolute -top-1 h-6 w-px bg-fg" style={{ left: x(price) }} />
                  </div>
                </td>
                <td className="px-2 text-right">{flat ? "—" : fmtPrice(r.low, lang)}</td>
                <td className="px-2 text-right font-semibold">{fmtPrice(r.mid, lang)}</td>
                <td className="pr-4 text-right">{flat ? "—" : fmtPrice(r.high, lang)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
