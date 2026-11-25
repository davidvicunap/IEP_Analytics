"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtBig, fmtDate, fmtNum } from "@/lib/format";
import { filingUrl, type Cell, type LineKey, type Period, type Split, type StatementKey } from "@/lib/secFinancials";
import { filingDocUrl, xbrlViewerUrl, type Filing } from "@/lib/filingsShared";
import {
  checkColumn, ttmColumn, type CheckIssue, type Column,
} from "@/lib/statements";
import {
  STATEMENT_ROWS, cagr, commonBase, fmtPct, fmtPerShare, fmtScaled, notReportedSince, pickScale, shownValue, type Mode, type Row,
} from "@/lib/financialsView";
import { useFilings } from "./filingsHooks";
import { useFinancials } from "./financialsHooks";
import { IssueNote, Panel, Segmented, Skeleton } from "./ui";

type Lang = "es" | "en";
type Kind = "actual" | "ttm";
type Range = "5" | "10" | "all";
const RANGES: Range[] = ["5", "10", "all"];
const STATEMENTS: StatementKey[] = ["income", "balance", "cashflow"];
const MODES: Mode[] = ["values", "common", "growth"];

interface DisplayColumn {
  period: Period;
  kind: Kind;
  cells: Column;
  /** What the growth reading compares with: the year before, or the same quarter a year earlier. */
  prev: Column | null;
  checks: ReturnType<typeof checkColumn> | null;
}

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

const DAY = 86_400_000;
const yearApart = (a: string, b: string) => {
  const d = (Date.parse(b) - Date.parse(a)) / DAY;
  return d > 340 && d < 390;
};

const columnOf = (lines: Partial<Record<LineKey, Cell[]>>, i: number): Column => {
  const out: Column = {};
  for (const [k, list] of Object.entries(lines) as [LineKey, Cell[]][]) out[k] = list[i];
  return out;
};

/**
 * One SEC statement as a printed annual report reads: one unit for the table, subtotals in
 * bold, negatives in parentheses, the latest year on the right next to its 5-year growth and
 * trend. Three readings: values, share of revenue (or assets), change on the year before.
 * On the stock page the statement is chosen by the tab's sub-navigation; in a canvas window
 * (no `statement`) it has its own switch.
 */
export default function FinancialStatements({ symbol, statement: fixed }: { symbol: string; statement?: StatementKey }) {
  const { t, lang } = useI18n();
  const [own, setOwn] = useState<StatementKey>("income");
  const statement = fixed ?? own;
  const [period, setPeriod] = useState<"annual" | "quarterly">("annual");
  const [range, setRange] = useState<Range>("10");
  const [mode, setMode] = useState<Mode>("values");
  const { state: filings } = useFilings(symbol);
  const { state, retry } = useFinancials(symbol);

  const byAccn = useMemo(() => {
    const m = new Map<string, Filing>();
    if (filings.status === "ok") for (const f of filings.data.filings) m.set(f.accn, f);
    return m;
  }, [filings]);

  // Every actual period (growth needs the one before the first shown), then the last 12 months.
  const { actual, extra } = useMemo(() => {
    const none = { actual: [] as DisplayColumn[], extra: [] as DisplayColumn[] };
    if (state.status !== "ok") return none;
    const fin = state.data;
    const set = period === "annual" ? fin.annual : fin.quarterly;
    const actual: DisplayColumn[] = set.periods.map((p, i) => {
      const cells = columnOf(set.lines, i);
      const back = period === "annual" ? i - 1 : i - 4;
      const prev = back >= 0 && yearApart(set.periods[back].end, p.end) ? columnOf(set.lines, back) : null;
      return { period: p, kind: "actual", cells, prev, checks: checkColumn(cells) };
    });
    const extra: DisplayColumn[] = [];
    if (period === "annual") {
      const ttm = ttmColumn(fin.quarterly, fin.annual.periods.at(-1)?.end ?? null);
      if (ttm) extra.push({ period: ttm.period, kind: "ttm", cells: ttm.cells, prev: null, checks: checkColumn(ttm.cells) });
    }
    return { actual, extra };
  }, [state, period]);

  if (state.status === "loading") {
    return (
      <div className="space-y-3">
        <p role="status" className="text-sm text-muted">{t.fin.loading}</p>
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-80" />
      </div>
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
  const perYear = period === "annual" ? 1 : 4;
  const shown = range === "all" ? actual : actual.slice(-Number(range) * perYear);
  const columns = [...shown, ...extra];
  const base = commonBase(statement);

  const unitLine =
    mode === "common" ? t.fin.commonLine[base as "revenue" | "totalAssets"] : mode === "growth" ? t.fin.growthLine[period] : null;

  return (
    <div className="space-y-3">
      {!fixed && (
        <Segmented label={t.fin.statementLabel} value={own} onChange={setOwn} options={STATEMENTS.map((s) => ({ value: s, label: t.fin.statements[s] }))} />
      )}
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&>*]:shrink-0">
        <Segmented
          label={t.fin.periodLabel}
          value={period}
          onChange={setPeriod}
          options={[
            { value: "annual", label: t.fin.annual },
            { value: "quarterly", label: t.fin.quarterly },
          ]}
        />
        <Segmented label={t.fin.rangeLabel} value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: t.fin.ranges[r] }))} />
        <Segmented
          label={t.fin.modeLabel}
          value={mode}
          onChange={setMode}
          options={MODES.map((m) => ({ value: m, label: m === "common" ? t.fin.modes.common[base as "revenue" | "totalAssets"] : t.fin.modes[m] }))}
        />
      </div>

      <StatementTable
        key={`${period}-${statement}`}
        statement={statement}
        columns={columns}
        actual={actual}
        mode={mode}
        annual={period === "annual"}
        summary={mode === "values"}
        splits={fin.shares.splits}
        unitLine={unitLine}
        cik={fin.cik}
        byAccn={byAccn}
        lang={lang}
      />

      <div className="max-w-[80ch] space-y-1 text-[11px] leading-relaxed text-muted">
        <p>{t.fin.derivedNote}</p>
        {period === "annual" && extra.some((c) => c.kind === "ttm") && <p>{t.fin.ttmNote}</p>}
        {statement === "income" && mode === "values" && <p>{fill(t.fin.verifyNote, { list: [t.fin.checks.gross, t.fin.checks.balance].join("; ") })}</p>}
        {statement === "cashflow" && mode !== "growth" && <p>{t.fin.outflowNote}</p>}
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
  actual,
  mode,
  annual,
  summary,
  splits,
  unitLine,
  cik,
  byAccn,
  lang,
}: {
  statement: StatementKey;
  columns: DisplayColumn[];
  actual: DisplayColumn[];
  mode: Mode;
  annual: boolean;
  summary: boolean;
  splits: Split[];
  unitLine: string | null;
  cik: number;
  byAccn: Map<string, Filing>;
  lang: Lang;
}) {
  const { t } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const rows = STATEMENT_ROWS[statement].filter(
    (r) => !(mode === "common" && r.kind) && columns.some((c) => c.cells[r.key] && c.cells[r.key]!.value !== null),
  );

  // Newest period is on the right: start scrolled to it.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [columns.length, mode]);

  if (rows.length === 0 || columns.length === 0) return null;

  // One unit for the money figures of the table; share counts get their own.
  const maxOf = (pick: (r: Row) => boolean) =>
    Math.max(0, ...columns.flatMap((c) => rows.filter(pick).map((r) => Math.abs(c.cells[r.key]?.value ?? 0))));
  const scale = pickScale(maxOf((r) => !r.kind));
  const sharesScale = pickScale(maxOf((r) => r.kind === "shares"));
  const fmtValue = (r: Row, v: number | null) =>
    mode !== "values" ? fmtPct(v, lang) : r.kind === "perShare" ? fmtPerShare(v, lang) : fmtScaled(v, r.kind === "shares" ? sharesScale : scale, lang);

  const shownActual = columns.filter((c) => c.kind === "actual");
  const lastIdx = actual.length - 1;
  const fiveYear = (key: LineKey) => (annual && lastIdx >= 5 ? cagr(actual[lastIdx - 5].cells[key]?.value, actual[lastIdx].cells[key]?.value, 5) : null);
  const firstShown = shownActual[0]?.period.end ?? "";
  const splitsShown = statement === "income" && mode !== "common" ? splits.filter((s) => s.before > firstShown) : [];
  const splitText = splitsShown
    .map((s) => {
      const [a, b] = s.ratio >= 1 ? [Math.round(s.ratio), 1] : [1, Math.round(1 / s.ratio)];
      return fill(s.ratio >= 1 ? t.fin.splitItem : t.fin.reverseSplitItem, { a: String(a), b: String(b), y: s.before.slice(0, 4) });
    })
    .join(t.fin.and);

  const tone = (k: Kind) => (k === "ttm" ? "bg-panel-2" : "");
  const cellBase = "text-right pl-4 py-2 whitespace-nowrap";
  const sticky = "sticky left-0 z-10 bg-panel text-left pl-4 pr-3 shadow-[1px_0_0_var(--border)]";
  const caption = `${t.fin.statements[statement]} · ${annual ? t.fin.annual : t.fin.quarterly}`;

  return (
    <Panel>
      <p className="mb-3 text-[12px] text-muted">
        {unitLine ?? fill(t.fin.unitLine, { unit: t.fin.units[scale.unit] })}
      </p>
      <div ref={scroller} className="relative overflow-x-auto -mx-4" tabIndex={0} role="region" aria-label={caption}>
        <table className="num text-[13px] w-max min-w-full border-separate border-spacing-0 [&_tr>*:last-child]:pr-4">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={`${sticky} font-normal text-muted border-b border-line-strong`}>
                <span className="sr-only">{t.fin.lineItem}</span>
              </th>
              {columns.map((c) => (
                <ColumnHeader key={`${c.kind}-${c.period.label}-${c.period.end}`} c={c} cik={cik} byAccn={byAccn} lang={lang} />
              ))}
              {summary && annual && (
                <th scope="col" className="text-right font-medium text-muted pl-6 pb-2 align-bottom border-b border-line-strong whitespace-nowrap" title={t.fin.cagrTitle}>
                  {t.fin.cagrHead}
                </th>
              )}
              {summary && (
                <th scope="col" className="text-left font-medium text-muted pl-4 pb-2 align-bottom border-b border-line-strong">
                  {t.fin.trendHead}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const since = notReportedSince(actual.map((c) => c.cells[r.key] ?? { value: null }), actual.map((c) => c.period));
              const rule = r.total ? "border-t border-line-strong" : "border-t border-line";
              const weight = r.total ? "font-semibold" : "";
              const unit = mode === "values" && r.kind ? (r.kind === "perShare" ? t.fin.perShareUnit : fill(t.fin.sharesUnit, { unit: t.fin.units[sharesScale.unit] })) : null;
              const g = summary ? fiveYear(r.key) : null;
              return (
                <tr key={r.key}>
                  <th scope="row" className={`${sticky} ${rule} py-2 font-sans ${r.total ? "font-semibold" : "font-medium"}`}>
                    <span className="block w-36 sm:w-52 whitespace-normal leading-snug">
                      {t.fin.lines[r.key]}
                      {unit && <span className="block text-[11px] font-normal text-muted">{unit}</span>}
                      {since && (
                        <span className="block text-[11px] font-normal text-muted" title={t.fin.notReportedTitle}>
                          {fill(t.fin.notReported, { p: since })}
                        </span>
                      )}
                    </span>
                  </th>
                  {columns.map((col, i) => {
                    const c = col.cells[r.key];
                    const v = shownValue(r, col.cells, col.prev, mode, statement);
                    return (
                      <td key={i} className={`${cellBase} ${rule} ${weight} ${tone(col.kind)}`} title={c && mode === "values" ? cellTitle(c, (x) => fmtValue(r, x), t.fin.altTitle, t.fin.splitTitle) : undefined}>
                        {fmtValue(r, v)}
                        {mode === "values" && c?.derived && c.derived !== "projection" && <span className="text-muted" aria-label={t.fin.derivedMark}>*</span>}
                        {mode === "values" && c?.alt && (
                          <span className="text-warn" aria-label={fill(t.fin.altTitle, { v: fmtValue(r, c.alt.value), concept: c.alt.concept })}>†</span>
                        )}
                      </td>
                    );
                  })}
                  {summary && annual && (
                    <td className={`${cellBase} ${rule} pl-6 ${weight}`}>{g === null ? <span className="text-muted">—</span> : fmtPct(g, lang)}</td>
                  )}
                  {summary && (
                    <td className={`pl-4 py-2 ${rule}`}>
                      <Spark values={shownActual.map((c) => c.cells[r.key]?.value ?? null)} />
                    </td>
                  )}
                </tr>
              );
            })}
            {statement === "income" && mode === "values" &&
              (["gross", "operating", "net"] as Margin[]).map((m, k) => (
                <tr key={m}>
                  <th scope="row" className={`${sticky} py-2 font-sans font-normal text-muted ${k === 0 ? "border-t border-line-strong" : "border-t border-line"}`}>
                    {t.fin.margins[m]}*
                  </th>
                  {columns.map((col, i) => (
                    <td key={i} className={`${cellBase} text-muted ${k === 0 ? "border-t border-line-strong" : "border-t border-line"} ${tone(col.kind)}`}>
                      {fmtPct(marginOf(col.cells, m), lang)}
                    </td>
                  ))}
                  {summary && annual && <td className={k === 0 ? "border-t border-line-strong" : "border-t border-line"} />}
                  {summary && <td className={k === 0 ? "border-t border-line-strong" : "border-t border-line"} />}
                </tr>
              ))}
            {statement === "income" && mode === "values" && (
              <tr>
                <th scope="row" className={`${sticky} py-2 font-sans font-normal text-muted border-t border-line`}>
                  {t.fin.verify}
                </th>
                {columns.map((col, i) => (
                  <td key={i} className={`${cellBase} border-t border-line ${tone(col.kind)}`}>
                    <CheckMark checks={col.checks} lang={lang} />
                  </td>
                ))}
                {summary && annual && <td className="border-t border-line" />}
                {summary && <td className="border-t border-line" />}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {splitText && <p className="mt-3 text-[12px] text-muted">{fill(t.fin.splitNote, { list: splitText })}</p>}
    </Panel>
  );
}

/** A row's shape over the years shown: decorative (the figures are in the row itself). */
function Spark({ values }: { values: (number | null)[] }) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return <span className="text-muted">—</span>;
  const max = Math.max(0, ...nums);
  const min = Math.min(0, ...nums);
  const span = max - min || 1;
  const W = 76;
  const H = 20;
  const gap = 2;
  const bw = Math.max(1.5, (W - gap * (values.length - 1)) / values.length);
  const zero = (max / span) * H;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="block">
      {values.map((v, i) =>
        v === null ? null : (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={v >= 0 ? zero - (v / span) * H : zero}
            width={bw}
            height={Math.max(1, (Math.abs(v) / span) * H)}
            rx={1}
            fill={v < 0 ? "var(--down)" : "var(--series-1)"}
            opacity={i === values.length - 1 ? 1 : 0.45}
          />
        ),
      )}
    </svg>
  );
}

function ColumnHeader({ c, cik, byAccn, lang }: { c: DisplayColumn; cik: number; byAccn: Map<string, Filing>; lang: Lang }) {
  const { t } = useI18n();
  const f = c.period.accn ? byAccn.get(c.period.accn) : undefined;
  const docHref = f ? filingDocUrl(cik, f) : c.period.accn ? filingUrl(cik, c.period.accn) : null;
  return (
    <th scope="col" className={`text-right font-semibold pl-4 pb-2 align-bottom whitespace-nowrap border-b border-line-strong ${c.kind === "ttm" ? "bg-panel-2" : ""}`}>
      {docHref ? (
        <a href={docHref} target="_blank" rel="noopener noreferrer" className="link" title={`${t.fin.openFiling} · ${fmtDate(c.period.end, lang)}`}>
          {c.period.label}
        </a>
      ) : (
        <span title={fmtDate(c.period.end, lang)}>{c.period.label}</span>
      )}
      {/* The date lives in the title; the second line is the filing itself (or the TTM span). */}
      <span className="block text-[11px] font-normal text-muted">
        {c.kind === "ttm" ? (
          fill(t.fin.ttmSub, { d: fmtDate(c.period.end, lang) })
        ) : f?.inlineXbrl ? (
          <a href={xbrlViewerUrl(cik, f)} target="_blank" rel="noopener noreferrer" className="link" title={t.fin.xbrlTitle}>
            {c.period.form ?? f.form} · {t.fin.xbrl}
          </a>
        ) : (
          (c.period.form ?? "")
        )}
      </span>
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

function cellTitle(c: Cell, fmt: (v: number | null) => string, altTitle: string, splitTitle: string): string | undefined {
  const parts: string[] = [];
  if (c.concept) parts.push(`us-gaap:${c.concept}${c.accn ? ` · ${c.accn}` : ""}`);
  else if (c.derived) parts.push("IEP");
  if (c.splitAdjusted) parts.push(fill(splitTitle, { k: String(+c.splitAdjusted.toFixed(4)) }));
  if (c.alt) parts.push(fill(altTitle, { v: fmt(c.alt.value), concept: `us-gaap:${c.alt.concept}` }));
  return parts.length ? parts.join("\n") : undefined;
}
