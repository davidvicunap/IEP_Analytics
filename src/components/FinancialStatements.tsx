"use client";

import { useEffect, useRef, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtBig, fmtDate, fmtNum } from "@/lib/format";
import type { FinancialsPayload } from "@/lib/financials";
import { filingUrl, type Cell, type LineKey, type Period, type StatementKey, type StatementSet } from "@/lib/secFinancials";
import type { DataIssue, Result } from "@/lib/types";
import { IssueNote, Panel } from "./ui";

const ORDER: Record<StatementKey, LineKey[]> = {
  income: ["revenue", "costOfRevenue", "grossProfit", "operatingIncome", "netIncome", "epsDiluted", "dilutedShares"],
  balance: ["cash", "totalAssets", "totalLiabilities", "longTermDebt", "equity"],
  cashflow: ["operatingCashFlow", "capex", "freeCashFlow", "dividendsPaid", "buybacks"],
};

type Margin = "gross" | "operating" | "net";

// First column stays put while the periods scroll; labels wrap on phones so numbers get the room.
const STICKY = "sticky left-0 z-10 bg-panel text-left pl-4 pr-3 shadow-[1px_0_0_var(--border)]";
const LABEL = "block w-28 sm:w-44";

/** Margin = line ÷ revenue; gross profit falls back to revenue − cost of revenue. */
export function marginCells(set: StatementSet, margin: Margin): (number | null)[] {
  const rev = set.lines.revenue;
  if (!rev) return [];
  return rev.map((r, i) => {
    if (!r.value) return null;
    const v =
      margin === "gross"
        ? set.lines.grossProfit?.[i]?.value ??
          (set.lines.costOfRevenue?.[i]?.value != null ? r.value - set.lines.costOfRevenue[i].value! : null)
        : margin === "operating"
          ? set.lines.operatingIncome?.[i]?.value ?? null
          : set.lines.netIncome?.[i]?.value ?? null;
    return v == null ? null : v / r.value;
  });
}

function cellTitle(c: Cell, key: LineKey, lang: "es" | "en", altTitle: string): string | undefined {
  const parts: string[] = [];
  if (c.concept) parts.push(`us-gaap:${c.concept}${c.accn ? ` · ${c.accn}` : ""}`);
  else if (c.derived) parts.push("IEP");
  if (c.alt) parts.push(fill(altTitle, { v: fmtCell(key, { value: c.alt.value }, lang), concept: `us-gaap:${c.alt.concept}` }));
  return parts.length ? parts.join("\n") : undefined;
}

function fmtCell(key: LineKey, c: Cell, lang: "es" | "en"): string {
  if (c.value === null) return "—";
  if (key === "epsDiluted") return `$${fmtNum(c.value, lang, 2)}`;
  if (key === "dilutedShares") return fmtBig(c.value, lang);
  const s = fmtBig(Math.abs(c.value), lang);
  return c.value < 0 ? `−$${s}` : `$${s}`;
}

const hasAlt = (set: StatementSet) => Object.values(set.lines).some((cells) => cells?.some((c) => c.alt));

export default function FinancialStatements({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<Result<FinancialsPayload> | null>(null);
  const [mode, setMode] = useState<"annual" | "quarterly">("annual");

  useEffect(() => {
    let alive = true;
    setState(null);
    fetch(`/api/sec/financials/${encodeURIComponent(symbol)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as Result<FinancialsPayload> | null;
        if (alive) setState(body ?? { ok: false, error: "upstream" });
      })
      .catch(() => alive && setState({ ok: false, error: "upstream" }));
    return () => {
      alive = false;
    };
  }, [symbol]);

  if (state === null) {
    return (
      <Panel title={t.fin.title}>
        <p role="status" className="text-sm text-muted">{t.fin.loading}</p>
        <div className="mt-3 h-48 rounded-lg bg-panel-2 animate-pulse" aria-hidden="true" />
      </Panel>
    );
  }
  if (!state.ok) {
    return (
      <Panel title={t.fin.title}>
        <IssueNote issue={state.error as DataIssue} />
      </Panel>
    );
  }

  const fin = state.data;
  const set = mode === "annual" ? fin.annual : fin.quarterly;
  const chip = (on: boolean) =>
    `h-9 px-3 rounded-md text-xs font-semibold border ${on ? "bg-accent text-accent-fg border-accent" : "border-line bg-panel hover:bg-panel-2"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mr-auto">{t.fin.title}</h2>
        <div role="group" aria-label={t.fin.title} className="flex gap-1">
          <button type="button" className={chip(mode === "annual")} aria-pressed={mode === "annual"} onClick={() => setMode("annual")}>
            {t.fin.annual}
          </button>
          <button type="button" className={chip(mode === "quarterly")} aria-pressed={mode === "quarterly"} onClick={() => setMode("quarterly")}>
            {t.fin.quarterly}
          </button>
        </div>
      </div>

      {(Object.keys(ORDER) as StatementKey[]).map((statement) => (
        <StatementTable key={`${mode}-${statement}`} statement={statement} set={set} cik={fin.cik} lang={lang} />
      ))}

      <div className="space-y-1 text-[11px] text-muted">
        <p>{t.fin.derivedNote}</p>
        {hasAlt(set) && <p>{t.fin.altNote}</p>}
        <p>
          {t.fin.source} · {t.data.updated} <time dateTime={state.fetchedAt}>{fmtAsOf(state.fetchedAt, lang)}</time>
        </p>
      </div>
    </div>
  );
}

function StatementTable({ statement, set, cik, lang }: { statement: StatementKey; set: StatementSet; cik: number; lang: "es" | "en" }) {
  const { t } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const lines = ORDER[statement].filter((k) => set.lines[k]);

  // Newest period is on the right: start scrolled to it.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [set]);

  if (lines.length === 0 || set.periods.length === 0) return null;
  const margins: Margin[] = statement === "income" ? ["gross", "operating", "net"] : [];

  return (
    <Panel title={t.fin.statements[statement]}>
      <div ref={scroller} className="overflow-x-auto -mx-4" tabIndex={0} aria-label={t.fin.statements[statement]}>
        <table className="num text-sm w-max min-w-full border-separate border-spacing-0 [&_tr>*:last-child]:pr-4">
          <caption className="sr-only">{t.fin.statements[statement]}</caption>
          <thead>
            <tr>
              <th scope="col" className={`${STICKY} font-normal text-muted`}>
                <span className="sr-only">{t.fin.lineItem}</span>
              </th>
              {set.periods.map((p) => (
                <PeriodHeader key={p.end + p.label} p={p} cik={cik} lang={lang} />
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((key) => (
              <tr key={key} className="border-t border-line">
                <th scope="row" className={`${STICKY} font-sans font-medium py-1.5 border-t border-line`}>
                  <span className={LABEL}>{t.fin.lines[key]}</span>
                </th>
                {set.lines[key]!.map((c, i) => (
                  <td
                    key={i}
                    className={`text-right pl-4 py-1.5 border-t border-line whitespace-nowrap ${c.value !== null && c.value < 0 ? "text-down" : ""}`}
                    title={cellTitle(c, key, lang, t.fin.altTitle)}
                  >
                    {fmtCell(key, c, lang)}
                    {c.derived && <span className="text-muted" aria-label={t.fin.derivedMark}>*</span>}
                    {c.alt && (
                      <span className="text-warn" aria-label={fill(t.fin.altTitle, { v: fmtCell(key, { value: c.alt.value }, lang), concept: c.alt.concept })}>
                        †
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {margins.map((m) => (
              <tr key={m}>
                <th scope="row" className={`${STICKY} font-sans text-muted py-1.5 border-t border-line`}>
                  <span className={LABEL}>{t.fin.margins[m]}*</span>
                </th>
                {marginCells(set, m).map((v, i) => (
                  <td key={i} className={`text-right pl-4 py-1.5 border-t border-line text-muted ${v !== null && v < 0 ? "text-down" : ""}`}>
                    {v === null ? "—" : `${fmtNum(v * 100, lang, 1)}%`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function PeriodHeader({ p, cik, lang }: { p: Period; cik: number; lang: "es" | "en" }) {
  const { t } = useI18n();
  return (
    <th scope="col" className="text-right font-semibold pl-4 pb-2 align-bottom whitespace-nowrap">
      {p.accn ? (
        <a href={filingUrl(cik, p.accn)} target="_blank" rel="noopener noreferrer" className="text-info underline" title={t.fin.openFiling}>
          {p.label}
        </a>
      ) : (
        p.label
      )}
      <span className="block text-[10px] font-normal text-muted">{fmtDate(p.end, lang)}</span>
    </th>
  );
}
