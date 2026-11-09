"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtBig, fmtDate, fmtNum } from "@/lib/format";
import type { FinancialsPayload } from "@/lib/financials";
import { filingUrl, type Cell, type LineKey, type Period, type StatementKey, type StatementSet } from "@/lib/secFinancials";
import { filingDocUrl, xbrlViewerUrl, type Filing } from "@/lib/filingsShared";
import {
  checkColumn, projectStatements, projectionDefaults, ttmColumn, type CheckIssue, type Column, type ProjectionAssumptions,
} from "@/lib/statements";
import type { AnnualIncome, Result } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { useFilings } from "./filingsHooks";
import { IssueNote, Panel } from "./ui";
import { NumberField } from "./valuation/fields";

type Lang = "es" | "en";
type Kind = "actual" | "ttm" | "projected";
interface DisplayColumn {
  period: Period;
  kind: Kind;
  cells: Column;
  checks: ReturnType<typeof checkColumn> | null;
}

const ORDER: Record<StatementKey, LineKey[]> = {
  income: ["revenue", "costOfRevenue", "grossProfit", "operatingIncome", "interestExpense", "pretaxIncome", "incomeTax", "netIncome", "epsDiluted", "dilutedShares"],
  balance: ["cash", "totalAssets", "totalLiabilities", "currentDebt", "longTermDebt", "equity"],
  cashflow: ["operatingCashFlow", "depreciation", "capex", "freeCashFlow", "dividendsPaid", "buybacks"],
};

type Margin = "gross" | "operating" | "net";

/** Margin = line ÷ revenue; gross profit falls back to revenue − cost of revenue. */
export function marginOf(c: Column, margin: Margin): number | null {
  const r = c.revenue?.value;
  if (!r) return null;
  const v =
    margin === "gross"
      ? c.grossProfit?.value ?? (c.costOfRevenue?.value != null ? r - c.costOfRevenue.value : null)
      : margin === "operating"
        ? c.operatingIncome?.value ?? null
        : c.netIncome?.value ?? null;
  return v == null ? null : v / r;
}

function fmtCell(key: LineKey, c: Cell | undefined, lang: Lang): string {
  if (!c || c.value === null) return "—";
  if (key === "epsDiluted") return `${c.value < 0 ? "−" : ""}$${fmtNum(Math.abs(c.value), lang, 2)}`;
  if (key === "dilutedShares") return fmtBig(c.value, lang);
  const s = fmtBig(Math.abs(c.value), lang);
  return c.value < 0 ? `−$${s}` : `$${s}`;
}

const columnOf = (set: StatementSet, i: number): Column => {
  const out: Column = {};
  for (const [k, list] of Object.entries(set.lines) as [LineKey, Cell[]][]) out[k] = list[i];
  return out;
};

const PROJ_ROWS: (keyof ProjectionAssumptions)[] = [
  "growth", "grossMargin", "opMargin", "interestPct", "otherPct", "taxRate", "daPct", "capexPct", "nwcPct", "payout", "buybackPct", "shareChange",
];
type Draft = { [K in keyof ProjectionAssumptions]: ProjectionAssumptions[K] extends number[] | null ? (number | null)[] | null : never };

function complete(d: Draft): ProjectionAssumptions | null {
  for (const k of PROJ_ROWS) {
    const row = d[k];
    if (row === null) {
      if (k !== "grossMargin") return null;
    } else if (row.some((x) => x === null)) return null;
  }
  return d as unknown as ProjectionAssumptions;
}

export default function FinancialStatements({ symbol, fmpIncome }: { symbol: string; fmpIncome?: Result<AnnualIncome[]> }) {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<"annual" | "quarterly">("annual");
  const [projecting, setProjecting] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const { state: filings } = useFilings(symbol);
  const { state, retry } = useResource<FinancialsPayload>(`/api/sec/financials/${encodeURIComponent(symbol)}`);

  const byAccn = useMemo(() => {
    const m = new Map<string, Filing>();
    if (filings.status === "ok") for (const f of filings.data.filings) m.set(f.accn, f);
    return m;
  }, [filings]);

  const defaults = useMemo(() => {
    if (state.status !== "ok") return null;
    return projectionDefaults(state.data.annual, state.data.shares.points.at(-1)?.value ?? null);
  }, [state]);

  // Columns to show: actual periods, then TTM (annual view), then projections when asked.
  const columns = useMemo<DisplayColumn[]>(() => {
    if (state.status !== "ok") return [];
    const fin = state.data;
    const set = mode === "annual" ? fin.annual : fin.quarterly;
    const fmp = fmpIncome?.ok ? new Map(fmpIncome.data.map((r) => [`FY${r.year}`, r])) : new Map<string, AnnualIncome>();
    const cols: DisplayColumn[] = set.periods.map((p, i) => {
      const cells = columnOf(set, i);
      const other = mode === "annual" ? fmp.get(p.label) : undefined;
      return { period: p, kind: "actual", cells, checks: checkColumn(cells, other ? { revenue: other.revenue, netIncome: other.netIncome } : undefined) };
    });
    if (mode === "annual") {
      const ttm = ttmColumn(fin.quarterly, fin.annual.periods.at(-1)?.end ?? null);
      if (ttm) cols.push({ period: ttm.period, kind: "ttm", cells: ttm.cells, checks: checkColumn(ttm.cells) });
      const a = projecting && draft && defaults ? complete(draft) : null;
      if (a && defaults) {
        const p = projectStatements(defaults.base, a);
        p.periods.forEach((period, i) => {
          const cells: Column = {};
          for (const [k, list] of Object.entries(p.lines) as [LineKey, Cell[]][]) cells[k] = list[i];
          cols.push({ period, kind: "projected", cells, checks: null });
        });
      }
    }
    return cols;
  }, [state, mode, fmpIncome, projecting, draft, defaults]);

  if (state.status === "loading") {
    return (
      <Panel title={t.fin.title}>
        <p role="status" className="text-sm text-muted">{t.fin.loading}</p>
        <div className="mt-3 h-48 rounded-lg bg-panel-2 animate-pulse" aria-hidden="true" />
      </Panel>
    );
  }
  if (state.status === "error") {
    return (
      <Panel title={t.fin.title}>
        <IssueNote issue={state.issue} onRetry={retry} />
      </Panel>
    );
  }

  const fin = state.data;
  const chip = (on: boolean) =>
    `h-9 px-3 rounded-md text-[13px] font-medium border ${on ? "bg-panel-2 text-fg border-line-strong" : "border-transparent text-muted hover:text-fg hover:bg-panel-2"}`;
  const toggleProjection = () => {
    if (!projecting && !draft && defaults) setDraft(defaults.assumptions as unknown as Draft);
    setProjecting((x) => !x);
    setMode("annual");
  };
  const checkList = [t.fin.checks.gross, t.fin.checks.balance, t.fin.checks.source].join("; ");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-title mr-auto">{t.fin.title}</h2>
        <div role="group" aria-label={t.fin.title} className="flex gap-1">
          <button type="button" className={chip(mode === "annual")} aria-pressed={mode === "annual"} onClick={() => setMode("annual")}>
            {t.fin.annual}
          </button>
          <button type="button" className={chip(mode === "quarterly")} aria-pressed={mode === "quarterly"} onClick={() => { setMode("quarterly"); setProjecting(false); }}>
            {t.fin.quarterly}
          </button>
        </div>
        <button type="button" className={chip(projecting)} aria-pressed={projecting} onClick={toggleProjection} disabled={!defaults}>
          {projecting ? t.fin.stopProject : t.fin.project}
        </button>
      </div>

      {projecting && mode === "annual" && (
        defaults && draft ? (
          <ProjectionEditor symbol={symbol} draft={draft} setDraft={setDraft} defaults={defaults.assumptions} />
        ) : (
          <Panel><p className="text-sm text-muted">{t.fin.projNoData}</p></Panel>
        )
      )}

      {(Object.keys(ORDER) as StatementKey[]).map((statement) => (
        <StatementTable
          key={`${mode}-${statement}`}
          statement={statement}
          columns={columns}
          cik={fin.cik}
          byAccn={byAccn}
          lang={lang}
          showChecks={statement === "income"}
        />
      ))}

      <div className="space-y-1 text-[11px] text-muted">
        <p>{t.fin.derivedNote}</p>
        {mode === "annual" && <p>{t.fin.ttmNote}</p>}
        <p>{fill(t.fin.verifyNote, { list: checkList })}</p>
        {columns.some((c) => Object.values(c.cells).some((x) => x?.alt)) && <p>{t.fin.altNote}</p>}
        <p>
          {t.fin.source} · {t.data.updated} <time dateTime={state.fetchedAt}>{fmtAsOf(state.fetchedAt, lang)}</time>
        </p>
      </div>
    </div>
  );
}

function StatementTable({
  statement,
  columns,
  cik,
  byAccn,
  lang,
  showChecks,
}: {
  statement: StatementKey;
  columns: DisplayColumn[];
  cik: number;
  byAccn: Map<string, Filing>;
  lang: Lang;
  showChecks: boolean;
}) {
  const { t } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const lines = ORDER[statement].filter((k) => columns.some((c) => c.kind !== "projected" && c.cells[k] && c.cells[k]!.value !== null));
  const firstProjected = columns.findIndex((c) => c.kind === "projected");

  // Newest period is on the right: start scrolled to it (or to the first projected year).
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [columns.length]);

  if (lines.length === 0 || columns.length === 0) return null;
  const margins: Margin[] = statement === "income" ? ["gross", "operating", "net"] : [];
  const tone = (k: Kind) => (k === "projected" ? "bg-info-bg/40 italic" : k === "ttm" ? "bg-panel-2" : "");

  return (
    <Panel title={t.fin.statements[statement]}>
      <div ref={scroller} className="relative overflow-x-auto -mx-4" tabIndex={0} aria-label={t.fin.statements[statement]}>
        <table className="num text-sm w-max min-w-full border-separate border-spacing-0 [&_tr>*:last-child]:pr-4">
          <caption className="sr-only">{t.fin.statements[statement]}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-panel text-left font-normal text-muted pl-4 pr-3 shadow-[1px_0_0_var(--border)]">
                <span className="sr-only">{t.fin.lineItem}</span>
              </th>
              {columns.map((c, i) => (
                <ColumnHeader key={`${c.kind}-${c.period.label}-${c.period.end}`} c={c} cik={cik} byAccn={byAccn} lang={lang} divider={i === firstProjected} />
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((key) => (
              <tr key={key}>
                <th scope="row" className="sticky left-0 z-10 bg-panel text-left font-sans font-medium pl-4 pr-3 py-1.5 border-t border-line shadow-[1px_0_0_var(--border)]">
                  <span className="block w-28 sm:w-48">{t.fin.lines[key]}</span>
                </th>
                {columns.map((col, i) => {
                  const c = col.cells[key];
                  return (
                    <td
                      key={i}
                      className={`text-right pl-4 py-1.5 border-t border-line whitespace-nowrap ${tone(col.kind)} ${c && c.value !== null && c.value < 0 ? "text-down" : ""}`}
                      title={c ? cellTitle(c, key, lang, t.fin.altTitle) : undefined}
                    >
                      {fmtCell(key, c, lang)}
                      {c?.derived && c.derived !== "projection" && <span className="text-muted" aria-label={t.fin.derivedMark}>*</span>}
                      {c?.alt && (
                        <span className="text-warn" aria-label={fill(t.fin.altTitle, { v: fmtCell(key, { value: c.alt.value }, lang), concept: c.alt.concept })}>
                          †
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {margins.map((m) => (
              <tr key={m}>
                <th scope="row" className="sticky left-0 z-10 bg-panel text-left font-sans text-muted pl-4 pr-3 py-1.5 border-t border-line shadow-[1px_0_0_var(--border)]">
                  {t.fin.margins[m]}*
                </th>
                {columns.map((col, i) => {
                  const v = marginOf(col.cells, m);
                  return (
                    <td key={i} className={`text-right pl-4 py-1.5 border-t border-line text-muted ${tone(col.kind)} ${v !== null && v < 0 ? "text-down" : ""}`}>
                      {v === null ? "—" : `${fmtNum(v * 100, lang, 1)}%`}
                    </td>
                  );
                })}
              </tr>
            ))}
            {showChecks && (
              <tr>
                <th scope="row" className="sticky left-0 z-10 bg-panel text-left font-sans text-muted pl-4 pr-3 py-1.5 border-t border-line shadow-[1px_0_0_var(--border)]">
                  {t.fin.verify}
                </th>
                {columns.map((col, i) => (
                  <td key={i} className={`text-right pl-4 py-1.5 border-t border-line ${tone(col.kind)}`}>
                    <CheckMark checks={col.checks} lang={lang} />
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ColumnHeader({ c, cik, byAccn, lang, divider }: { c: DisplayColumn; cik: number; byAccn: Map<string, Filing>; lang: Lang; divider: boolean }) {
  const { t } = useI18n();
  const f = c.period.accn ? byAccn.get(c.period.accn) : undefined;
  const docHref = f ? filingDocUrl(cik, f) : c.period.accn ? filingUrl(cik, c.period.accn) : null;
  return (
    <th scope="col" className={`text-right font-semibold pl-4 pb-2 align-bottom whitespace-nowrap ${divider ? "border-l-2 border-info" : ""}`}>
      {c.kind === "projected" ? (
        <span className="text-info">{c.period.label}</span>
      ) : docHref ? (
        <a href={docHref} target="_blank" rel="noopener noreferrer" className="link" title={t.fin.openFiling}>
          {c.period.label}
        </a>
      ) : (
        c.period.label
      )}
      <span className="block text-[10px] font-normal text-muted">
        {c.kind === "projected"
          ? t.fin.projectedSub
          : c.kind === "ttm"
            ? fill(t.fin.ttmSub, { d: fmtDate(c.period.end, lang) })
            : fmtDate(c.period.end, lang)}
      </span>
      {c.kind !== "projected" && (docHref || f?.inlineXbrl) && (
        <span className="block text-[10px] font-normal">
          {docHref && (
            <a href={docHref} target="_blank" rel="noopener noreferrer" className="link" title={t.fin.docTitle}>
              {t.fin.doc}
            </a>
          )}
          {f?.inlineXbrl && (
            <>
              {" · "}
              <a href={xbrlViewerUrl(cik, f)} target="_blank" rel="noopener noreferrer" className="link" title={t.fin.xbrlTitle}>
                {t.fin.xbrl}
              </a>
            </>
          )}
        </span>
      )}
    </th>
  );
}

function CheckMark({ checks, lang }: { checks: DisplayColumn["checks"]; lang: Lang }) {
  const { t } = useI18n();
  if (!checks || checks.checked === 0) return <span className="text-muted" title={t.fin.verifyNone}>—</span>;
  const money = (v: number) => `${v < 0 ? "−" : ""}$${fmtBig(Math.abs(v), lang)}`;
  const describe = (i: CheckIssue) =>
    i.kind === "gross"
      ? fill(t.fin.issues.gross, { r: money(i.reported), e: money(i.expected) })
      : i.kind === "balance"
        ? fill(t.fin.issues.balance, { a: money(i.assets), l: money(i.liabilitiesPlusEquity) })
        : fill(t.fin.issues.source, {
            line: i.line === "revenue" ? t.fin.lines.revenue : t.fin.lines.netIncome,
            s: money(i.sec),
            o: money(i.other),
            d: `${fmtNum(((i.sec - i.other) / Math.abs(i.other)) * 100, lang, 1)}%`,
          });
  const text = checks.ok
    ? fill(t.fin.verifyOk, { list: String(checks.checked) })
    : fill(t.fin.verifyIssues, { list: checks.issues.map(describe).join("; ") });
  return checks.ok ? (
    <span className="text-up" title={text} aria-label={text}>✓</span>
  ) : (
    <span className="text-warn cursor-help" title={text} aria-label={text}>⚠</span>
  );
}

function cellTitle(c: Cell, key: LineKey, lang: Lang, altTitle: string): string | undefined {
  const parts: string[] = [];
  if (c.concept) parts.push(`us-gaap:${c.concept}${c.accn ? ` · ${c.accn}` : ""}`);
  else if (c.derived) parts.push("IEP");
  if (c.alt) parts.push(fill(altTitle, { v: fmtCell(key, { value: c.alt.value }, lang), concept: `us-gaap:${c.alt.concept}` }));
  return parts.length ? parts.join("\n") : undefined;
}

// ---- Projection assumptions --------------------------------------------------------------

interface SavedProjection {
  name: string;
  draft: Draft;
}
const projKey = (symbol: string) => `iep:proj:${symbol}`;
function readProjections(symbol: string): SavedProjection[] {
  try {
    const raw = localStorage.getItem(projKey(symbol));
    const list = raw ? (JSON.parse(raw) as SavedProjection[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function writeProjections(symbol: string, list: SavedProjection[]) {
  try {
    localStorage.setItem(projKey(symbol), JSON.stringify(list));
  } catch {
    /* storage blocked: scenarios last for this visit only */
  }
}

function ProjectionEditor({
  symbol,
  draft,
  setDraft,
  defaults,
}: {
  symbol: string;
  draft: Draft;
  setDraft: (d: Draft) => void;
  defaults: ProjectionAssumptions;
}) {
  const { t } = useI18n();
  const [saved, setSaved] = useState<SavedProjection[]>(() => readProjections(symbol));
  const [name, setName] = useState("");
  const rows = PROJ_ROWS.filter((k) => draft[k] !== null);
  const years = draft.growth!.length;
  const ready = complete(draft) !== null;
  const setCell = (k: keyof ProjectionAssumptions, i: number, v: number | null) =>
    setDraft({ ...draft, [k]: draft[k]!.map((x, j) => (j === i ? v : x)) });

  return (
    <Panel title={t.fin.projTitle}>
      <p className="text-xs text-muted mb-3">{t.fin.projIntro}</p>
      <div className="relative overflow-x-auto -mx-4" tabIndex={0} aria-label={t.fin.projTitle}>
        <table className="num text-sm w-max min-w-full border-separate border-spacing-0">
          <caption className="sr-only">{t.fin.projTitle}</caption>
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="sticky left-0 z-10 bg-panel text-left font-normal pl-4 pr-3 pb-2">
                <span className="sr-only">{t.fin.assumption}</span>
              </th>
              {Array.from({ length: years }, (_, i) => (
                <th key={i} scope="col" className="text-right font-normal px-1 pb-2">{fill(t.fin.year, { n: i + 1 })}</th>
              ))}
              <th scope="col" className="pr-4 pb-2"><span className="sr-only">{t.fin.projCopy}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k} className="border-t border-line">
                <th scope="row" className="sticky left-0 z-10 bg-panel text-left font-sans font-medium pl-4 pr-3 py-1 text-xs">
                  <span className="block w-40 whitespace-normal">{t.fin.rows[k]}</span>
                </th>
                {draft[k]!.map((x, i) => (
                  <td key={i} className="px-1 py-1 w-24 min-w-24">
                    <NumberField
                      label={`${t.fin.rows[k]}, ${fill(t.fin.year, { n: i + 1 })}`}
                      srLabel
                      value={x}
                      scale={100}
                      digits={2}
                      suffix="%"
                      onChange={(v) => setCell(k, i, v)}
                    />
                  </td>
                ))}
                <td className="pr-4 pl-1">
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, [k]: draft[k]!.map(() => draft[k]![0]) })}
                    aria-label={fill(t.fin.projCopy, { row: t.fin.rows[k] })}
                    title={fill(t.fin.projCopy, { row: t.fin.rows[k] })}
                    className="h-8 w-8 rounded-md border border-line bg-panel hover:bg-panel-2 text-muted"
                  >
                    →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!ready && <p role="status" className="mt-2 text-xs text-warn">{t.fin.projBadInputs}</p>}

      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          const label = name.trim() || `${t.fin.projScenarios} ${saved.length + 1}`;
          const next = [...saved.filter((s) => s.name !== label), { name: label, draft }];
          setSaved(next);
          writeProjections(symbol, next);
          setName("");
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="proj-name" className="text-[11px] text-muted">{t.fin.projName}</label>
          <input id="proj-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="h-9 w-48 rounded-md border border-line bg-panel px-2 text-sm" />
        </div>
        <button type="submit" disabled={!ready} className="h-11 sm:h-9 px-3.5 rounded-lg text-[13px] font-medium bg-accent text-accent-fg hover:brightness-110 disabled:opacity-50">{t.fin.projSave}</button>
        <button type="button" onClick={() => setDraft(defaults as unknown as Draft)} className="h-11 sm:h-9 px-3.5 rounded-lg text-[13px] font-medium border border-line bg-panel hover:bg-panel-2">
          {t.fin.projReset}
        </button>
      </form>
      {saved.length > 0 && (
        <ul className="mt-3 divide-y divide-line" aria-label={t.fin.projScenarios}>
          {saved.map((s) => (
            <li key={s.name} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="font-medium mr-auto">{s.name}</span>
              <button type="button" onClick={() => setDraft(s.draft)} className="h-8 px-2 rounded-md text-xs border border-line hover:bg-panel-2">{t.fin.projLoad}</button>
              <button
                type="button"
                onClick={() => {
                  const next = saved.filter((x) => x.name !== s.name);
                  setSaved(next);
                  writeProjections(symbol, next);
                }}
                className="h-8 px-2 rounded-md text-xs border border-line hover:bg-panel-2"
              >
                {t.fin.projDelete}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-muted">{t.fin.projModel} {t.fin.projSaved}</p>
    </Panel>
  );
}
