"use client";

import { useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtBig, fmtNum, fmtPrice } from "@/lib/format";
import { compsRow, impliedValues, peerStats, type CompsMultiple, type CompsRow } from "@/lib/comps";
import type { CompsPayload } from "@/lib/compsData";
import { shown as shownData } from "@/lib/resource";
import { useResource } from "@/lib/useResource";
import { IssueNote, Panel } from "../ui";
import { NumberField } from "./fields";

type Lang = "es" | "en";
const MAX = 15;
const money = (v: number | null) => (v === null ? "—" : v < 0 ? `−$${fmtBig(-v)}` : `$${fmtBig(v)}`);
const pct = (v: number | null, lang: Lang) => (v === null ? "—" : `${fmtNum(v * 100, lang, 1)}%`);
const mult = (m: CompsMultiple, v: number | null, lang: Lang) =>
  v === null ? "—" : m === "fcfYield" ? pct(v, lang) : `${fmtNum(v, lang, 1)}x`;

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

export default function CompsView({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const peersKey = `iep:comps:peers:${symbol}`;
  const manualKey = `iep:comps:manual:${symbol}`;
  const [peers, setPeers] = useState<string[] | null>(() => store.get<string[]>(peersKey));
  const [manual, setManual] = useState<Record<string, number>>(() => store.get<Record<string, number>>(manualKey) ?? {});
  const [stat, setStat] = useState<"median" | "mean">("median");
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
    const target = compsRow({ ...d.target, marketCapSource: d.target.marketCap ? "market" : null });
    const rows: CompsRow[] = d.peers.map((p) => {
      const typed = manual[p.symbol];
      const marketCap = p.marketCap ?? (typed ? typed : null);
      return compsRow({ ...p, marketCap, marketCapSource: p.marketCap ? "market" : typed ? "manual" : null });
    });
    return { d, target, rows };
  }, [onScreen, manual]);

  if (state.status === "loading" && !onScreen) {
    return (
      <Panel title={t.comps.title}>
        <p role="status" className="text-sm text-muted">{t.comps.loading}</p>
        <div className="mt-3 h-48 rounded-lg bg-panel-2 animate-pulse" aria-hidden="true" />
      </Panel>
    );
  }
  if (state.status === "error" || !view) {
    return (
      <Panel title={t.comps.title}>
        <IssueNote issue={state.status === "error" ? state.issue : "upstream"} onRetry={retry} />
      </Panel>
    );
  }

  const { d, target, rows } = view;
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
  const implied = impliedValues(target, rows, d.target.price, stat).filter((v) => shown.includes(v.multiple));

  return (
    <div className={`space-y-4 transition-opacity ${updating ? "opacity-60" : ""}`} aria-busy={updating}>
      <div className="space-y-1">
        <h2 className="section-title">{t.comps.title}</h2>
        <p className="text-sm">{fill(t.comps.basis, { year: d.year })}</p>
        <p className="text-xs text-muted">{d.suggested ? t.comps.suggested : t.comps.custom}</p>
      </div>

      <Panel>
        <ul className="flex flex-wrap gap-2" aria-label={t.comps.title}>
          {current.map((s) => (
            <li key={s} className="inline-flex items-center gap-1 rounded-full border border-line bg-panel-2 pl-3 pr-1 h-8 text-sm">
              <span className="font-medium">{s}</span>
              <button
                type="button"
                onClick={() => updatePeers(current.filter((x) => x !== s))}
                aria-label={fill(t.comps.remove, { s })}
                className="h-6 w-6 rounded-full hover:bg-panel text-muted"
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
          <button type="submit" disabled={current.length >= MAX} className="h-11 sm:h-9 px-3.5 rounded-lg text-[13px] font-medium bg-accent text-accent-fg hover:brightness-110 disabled:opacity-50">
            {t.comps.add}
          </button>
          {!d.suggested && (
            <button type="button" onClick={() => updatePeers(null)} className="h-11 sm:h-9 px-3.5 rounded-lg text-[13px] font-medium border border-line bg-panel hover:bg-panel-2">
              {t.comps.resetPeers}
            </button>
          )}
        </form>
        {current.length >= MAX && <p className="mt-2 text-xs text-muted">{fill(t.comps.maxPeers, { n: MAX })}</p>}
        {d.unknown.length > 0 && <p className="mt-2 text-xs text-warn">{fill(t.comps.unknown, { list: d.unknown.join(", ") })}</p>}
        {d.marketCapsIssue && <IssueNote issue={d.marketCapsIssue} className="mt-2" />}
      </Panel>

      <Panel>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">{t.comps.noPeers}</p>
        ) : (
          <CompsTable target={target} rows={rows} shown={shown} lang={lang} onManual={updateManual} />
        )}
        {financial && <p className="mt-2 text-[11px] text-muted">{t.comps.bankNote}</p>}
      </Panel>

      <Panel title={t.comps.impliedTitle}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <p className="text-xs text-muted max-w-2xl">
            {fill(t.comps.impliedIntro, { stat: stat === "median" ? t.comps.median.toLowerCase() : t.comps.mean.toLowerCase(), price: fmtPrice(d.target.price, lang) })}
          </p>
          <div role="group" aria-label={t.comps.statLabel} className="flex gap-1">
            {(["median", "mean"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={stat === s}
                onClick={() => setStat(s)}
                className={`h-8 px-3 rounded-md text-[13px] font-medium border ${stat === s ? "bg-panel-2 text-fg border-line-strong" : "border-transparent text-muted hover:text-fg hover:bg-panel-2"}`}
              >
                {s === "median" ? t.comps.median : t.comps.mean}
              </button>
            ))}
          </div>
        </div>
        {implied.length === 0 ? <p className="text-sm text-muted">{t.comps.noImplied}</p> : <FootballField ranges={implied} price={d.target.price} lang={lang} />}
      </Panel>

      <div className="space-y-1 text-[11px] text-muted">
        <p>{t.comps.formulas}</p>
        <p>{t.comps.sources}</p>
      </div>
    </div>
  );
}

function CompsTable({
  target,
  rows,
  shown,
  lang,
  onManual,
}: {
  target: CompsRow;
  rows: CompsRow[];
  shown: CompsMultiple[];
  lang: Lang;
  onManual: (s: string, v: number | null) => void;
}) {
  const { t } = useI18n();
  const cols = t.comps.cols;
  const statsRow = (label: string, pick: "median" | "mean") => (
    <tr className="border-t-2 border-line text-muted">
      <th scope="row" className="sticky left-0 z-10 bg-panel text-left font-sans font-medium pl-4 pr-3 py-1.5">{label}</th>
      <td />
      {!shown.every((m) => m === "pe" || m === "pb") && <td />}
      {shown.map((m) => {
        const s = peerStats(rows, m);
        return (
          <td key={m} className="text-right px-2">
            {s ? mult(m, pick === "median" ? s.median : s.mean, lang) : "—"}
          </td>
        );
      })}
      <td />
      <td className="pr-4" />
    </tr>
  );
  const ev = !shown.every((m) => m === "pe" || m === "pb");
  const line = (r: CompsRow, isTarget: boolean) => (
    <tr key={r.symbol} className={`border-t border-line ${isTarget ? "bg-panel-2" : ""}`}>
      <th scope="row" className={`sticky left-0 z-10 text-left font-sans pl-4 pr-3 py-1.5 ${isTarget ? "bg-panel-2" : "bg-panel"}`}>
        <span className="font-medium">{r.symbol}</span>
        {isTarget && <span className="ml-1 text-[11px] text-muted">({t.comps.thisCompany})</span>}
        <span className="block w-36 truncate text-[11px] font-normal text-muted" title={r.name}>{r.name}</span>
        {!r.inputs && <span className="block text-[11px] font-normal text-warn">{t.comps.noData}</span>}
      </th>
      <td className="text-right px-2 align-top py-1.5">
        {isTarget || r.marketCapSource === "market" ? (
          money(r.marketCap)
        ) : (
          <div className="w-28 ml-auto">
            <NumberField
              label={fill(t.comps.manualLabel, { s: r.symbol })}
              srLabel
              value={r.marketCap}
              scale={1e-9}
              digits={1}
              placeholder={t.comps.manualPlaceholder}
              onChange={(v) => onManual(r.symbol, v)}
            />
            <span className="block text-[10px] text-muted whitespace-normal text-left mt-0.5">
              {r.marketCapSource === "manual" ? t.comps.manual : t.comps.noPrice}
            </span>
          </div>
        )}
      </td>
      {ev && <td className="text-right px-2 align-top py-1.5">{money(r.ev)}</td>}
      {shown.map((m) => (
        <td key={m} className="text-right px-2 align-top py-1.5">{mult(m, r.multiples[m], lang)}</td>
      ))}
      <td className="text-right px-2 align-top py-1.5">{pct(r.growth, lang)}</td>
      <td className="text-right pr-4 align-top py-1.5">{pct(r.operatingMargin, lang)}</td>
    </tr>
  );
  return (
    <div className="relative overflow-x-auto -mx-4" tabIndex={0} aria-label={t.comps.title}>
      <table className="num text-sm w-max min-w-full border-separate border-spacing-0">
        <caption className="sr-only">{t.comps.title}</caption>
        <thead>
          <tr className="text-muted text-xs">
            <th scope="col" className="sticky left-0 z-10 bg-panel text-left font-normal pl-4 pr-3 pb-2">{cols.company}</th>
            <th scope="col" className="text-right font-normal px-2 pb-2">{cols.marketCap}</th>
            {ev && <th scope="col" className="text-right font-normal px-2 pb-2">{cols.ev}</th>}
            {shown.map((m) => (
              <th key={m} scope="col" className="text-right font-normal px-2 pb-2">{cols[m]}</th>
            ))}
            <th scope="col" className="text-right font-normal px-2 pb-2">{cols.growth}</th>
            <th scope="col" className="text-right font-normal pr-4 pb-2">{cols.opMargin}</th>
          </tr>
        </thead>
        <tbody>
          {line(target, true)}
          {rows.map((r) => line(r, false))}
          {statsRow(t.comps.median, "median")}
          {statsRow(t.comps.mean, "mean")}
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
    <div className="relative overflow-x-auto -mx-4" tabIndex={0} aria-label={t.comps.impliedTitle}>
      <table className="num text-sm w-full min-w-[36rem]">
        <caption className="sr-only">{t.comps.impliedTitle}</caption>
        <thead>
          <tr className="text-muted text-xs">
            <th scope="col" className="text-left font-normal pl-4 py-1">{t.comps.impliedCols.multiple}</th>
            <th scope="col" className="w-2/5"><span className="sr-only">{t.comps.impliedTitle}</span></th>
            <th scope="col" className="text-right font-normal px-2">{t.comps.impliedCols.low}</th>
            <th scope="col" className="text-right font-normal px-2">{t.comps.impliedCols.mid}</th>
            <th scope="col" className="text-right font-normal pr-4">{t.comps.impliedCols.high}</th>
          </tr>
        </thead>
        <tbody>
          {ranges.map((r) => (
            <tr key={r.multiple} className="border-t border-line">
              <th scope="row" className="text-left font-sans font-medium pl-4 py-2">{t.comps.cols[r.multiple]}</th>
              <td className="px-2">
                <div className="relative h-4" aria-hidden="true">
                  <div className="absolute top-1.5 h-1 left-0 right-0 rounded bg-panel-2" />
                  <div className="absolute top-0.5 h-3 rounded bg-series-1/35" style={{ left: x(r.low), width: `calc(${x(r.high)} - ${x(r.low)})` }} />
                  <div className="absolute top-0 h-4 w-1 rounded bg-series-1" style={{ left: `calc(${x(r.mid)} - 2px)` }} />
                  <div className="absolute -top-1 h-6 w-px bg-fg" style={{ left: x(price) }} />
                </div>
              </td>
              <td className="text-right px-2">{fmtPrice(r.low, lang)}</td>
              <td className="text-right px-2 font-semibold">{fmtPrice(r.mid, lang)}</td>
              <td className="text-right pr-4">{fmtPrice(r.high, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
