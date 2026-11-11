"use client";

import { useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtBig, fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { impliedRevenueGrowth, runDcf, sensitivity, waccOf, type MakerAssumptions, type MakerResult } from "@/lib/dcfModel";
import type { ValuationPayload } from "@/lib/valuationData";
import { saveNote } from "@/lib/researchClient";
import { Panel, StatusMessage, buttonClass } from "../ui";
import { NumberField } from "./fields";

type Lang = "es" | "en";
type RowKey = "growth" | "ebitMargin" | "daPct" | "capexPct" | "nwcPct";
const ROWS: RowKey[] = ["growth", "ebitMargin", "daPct", "capexPct", "nwcPct"];
const money = (v: number) => (v < 0 ? `−$${fmtBig(-v)}` : `$${fmtBig(v)}`);
const pct = (v: number, lang: Lang, d = 1) => `${fmtNum(v * 100, lang, d)}%`;

interface Saved {
  name: string;
  assumptions: MakerAssumptions;
  savedAt: string;
}
const storeKey = (symbol: string) => `iep:dcf:scenarios:${symbol}`;
function readSaved(symbol: string): Saved[] {
  try {
    const raw = localStorage.getItem(storeKey(symbol));
    const list = raw ? (JSON.parse(raw) as Saved[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function writeSaved(symbol: string, list: Saved[]) {
  try {
    localStorage.setItem(storeKey(symbol), JSON.stringify(list));
  } catch {
    /* storage blocked: scenarios last for this visit only */
  }
}

/** Assumptions being edited: numbers, or null while a field is empty or invalid. */
type Draft = Omit<MakerAssumptions, RowKey | "taxRate" | "rf" | "beta" | "erp" | "costOfDebt" | "terminalGrowth" | "exitMultiple"> & {
  [K in RowKey]: (number | null)[];
} & { taxRate: number | null; rf: number | null; beta: number | null; erp: number | null; costOfDebt: number | null; terminalGrowth: number | null; exitMultiple: number | null };

function complete(d: Draft): MakerAssumptions | null {
  const scalars = [d.taxRate, d.rf, d.beta, d.erp, d.costOfDebt, d.terminalGrowth, d.exitMultiple];
  if (scalars.some((x) => x === null) || ROWS.some((k) => d[k].some((x) => x === null))) return null;
  return d as MakerAssumptions;
}

export default function DcfMaker({ v }: { v: ValuationPayload }) {
  const { t, lang } = useI18n();
  const m = v.maker;
  const [draft, setDraft] = useState<Draft | null>(m.defaults);
  const [saved, setSaved] = useState<Saved[]>(() => readSaved(v.symbol));
  const [name, setName] = useState("");

  const a = draft ? complete(draft) : null;
  const run = useMemo(() => (a && m.base ? runDcf(m.base, a) : null), [a, m.base]);
  const result: MakerResult | null = run?.ok ? run.result : null;
  const implied = useMemo(() => (a && m.base && result ? impliedRevenueGrowth(m.base, a) : null), [a, m.base, result]);
  const sens = useMemo(
    () =>
      a && m.base && result
        ? sensitivity(m.base, a, [-0.01, -0.005, 0, 0.005, 0.01], a.terminal === "gordon" ? [-0.005, -0.0025, 0, 0.0025, 0.005] : [-2, -1, 0, 1, 2])
        : null,
    [a, m.base, result],
  );

  if (m.issue || !m.base || !draft || !m.defaults) {
    return (
      <Panel title={t.maker.title}>
        <p className="text-sm text-muted">{m.issue === "notApplicable" ? t.maker.notApplicable : t.maker.noRevenue}</p>
      </Panel>
    );
  }
  const base = m.base;
  const set = <K extends keyof Draft>(k: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: value } : d));
  const setCell = (k: RowKey, i: number, value: number | null) =>
    setDraft((d) => (d ? { ...d, [k]: d[k].map((x, j) => (j === i ? value : x)) } : d));
  const w = a ? waccOf(base, a) : null;
  const shares = base.marketCap / base.price;
  const ttm: Record<RowKey, number | null> = {
    growth: m.data?.revenueCagr5 ?? null,
    ebitMargin: m.data?.ebit != null ? m.data.ebit / base.revenue0 : null,
    daPct: m.data?.da != null ? m.data.da / base.revenue0 : null,
    capexPct: m.data?.capex != null ? m.data.capex / base.revenue0 : null,
    nwcPct: null,
  };

  const save = () => {
    if (!a) return;
    const label = name.trim() || `${t.maker.scenariosTitle} ${saved.length + 1}`;
    const next = [...saved.filter((s) => s.name !== label), { name: label, assumptions: a, savedAt: new Date().toISOString() }];
    setSaved(next);
    writeSaved(v.symbol, next);
    setName("");
  };
  const csv = () => {
    if (!result || !a) return;
    const head = ["", ...result.years.map((y) => fill(t.maker.year, { n: y.t }))];
    const line = (label: string, xs: (number | string)[]) => [label, ...xs].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",");
    const rows = [
      line("", head.slice(1)),
      line(t.maker.rows.growth, a.growth),
      line(t.maker.rows.ebitMargin, a.ebitMargin),
      line(t.maker.rows.daPct, a.daPct),
      line(t.maker.rows.capexPct, a.capexPct),
      line(t.maker.rows.nwcPct, a.nwcPct),
      line(t.maker.proj.revenue, result.years.map((y) => y.revenue)),
      line(t.maker.proj.ebit, result.years.map((y) => y.ebit)),
      line(t.maker.proj.fcff, result.years.map((y) => y.fcff)),
      line(t.maker.proj.pv, result.years.map((y) => y.pv)),
      line("WACC", [result.wacc]),
      line(t.maker.result.ev, [result.ev]),
      line(t.maker.result.equity, [result.equity]),
      line(t.maker.result.perShare, [result.perShare]),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dcf-${v.symbol}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="section-title">{t.maker.title}</h2>
        <p className="text-sm">{t.maker.intro}</p>
        <p className="text-xs text-muted">
          {fill(t.maker.base, {
            ttm: m.ttmLabel ?? "—",
            rev: money(base.revenue0),
            debt: money(base.debt),
            cash: money(base.cash),
            shares: fmtBig(shares),
            price: fmtPrice(base.price, lang),
          })}
        </p>
      </div>

      {/* Assumptions per year */}
      <Panel>
        <div className="relative overflow-x-auto -mx-4" tabIndex={0} aria-label={t.maker.title}>
          <table className="num text-sm w-max min-w-full border-separate border-spacing-0">
            <caption className="sr-only">{t.maker.title}</caption>
            <thead>
              <tr className="text-xs text-muted">
                <th scope="col" className="sticky left-0 z-10 bg-panel text-left font-normal pl-4 pr-3 pb-2">
                  <span className="sr-only">{t.maker.assumption}</span>
                </th>
                <th scope="col" className="text-right font-normal px-2 pb-2">{t.maker.ttmCol}</th>
                {draft.growth.map((_, i) => (
                  <th key={i} scope="col" className="text-right font-normal px-1 pb-2">{fill(t.maker.year, { n: i + 1 })}</th>
                ))}
                <th scope="col" className="pr-4 pb-2"><span className="sr-only">{t.maker.fillRow}</span></th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((k) => (
                <tr key={k} className="border-t border-line">
                  <th scope="row" className="sticky left-0 z-10 bg-panel text-left font-sans font-medium pl-4 pr-3 py-1 text-xs w-44">
                    <span className="block w-40 whitespace-normal">{t.maker.rows[k]}</span>
                  </th>
                  <td className="text-right px-2 text-muted text-xs">{ttm[k] === null ? "—" : pct(ttm[k]!, lang)}</td>
                  {draft[k].map((x, i) => (
                    <td key={i} className="px-1 py-1 w-24 min-w-24">
                      <NumberField
                        label={`${t.maker.rows[k]}, ${fill(t.maker.year, { n: i + 1 })}`}
                        srLabel
                        value={x}
                        scale={100}
                        digits={2}
                        suffix="%"
                        onChange={(val) => setCell(k, i, val)}
                      />
                    </td>
                  ))}
                  <td className="pr-4 pl-1">
                    <button
                      type="button"
                      onClick={() => set(k, draft[k].map(() => draft[k][0]))}
                      aria-label={fill(t.maker.fillRow, { row: t.maker.rows[k] })}
                      title={fill(t.maker.fillRow, { row: t.maker.rows[k] })}
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
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t.maker.waccTitle}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <NumberField label={t.maker.fields.rf} value={draft.rf} scale={100} suffix="%" onChange={(x) => set("rf", x)} />
            <NumberField label={t.maker.fields.beta} value={draft.beta} digits={2} onChange={(x) => set("beta", x)} />
            <NumberField label={t.maker.fields.erp} value={draft.erp} scale={100} suffix="%" onChange={(x) => set("erp", x)} />
            <NumberField label={t.maker.fields.costOfDebt} value={draft.costOfDebt} scale={100} suffix="%" onChange={(x) => set("costOfDebt", x)} />
            <NumberField label={t.maker.fields.taxRate} value={draft.taxRate} scale={100} suffix="%" onChange={(x) => set("taxRate", x)} />
            <NumberField label={t.maker.fields.waccOverride} value={draft.waccOverride} scale={100} suffix="%" onChange={(x) => set("waccOverride", x)} />
          </div>
          {w && (
            <p className="mt-3 text-xs text-muted">
              {draft.waccOverride !== null
                ? fill(t.maker.waccManual, { wacc: pct(w.wacc, lang, 2) })
                : fill(t.maker.waccLine, {
                    ke: pct(w.costOfEquity, lang, 2),
                    kd: pct(w.afterTaxCostOfDebt, lang, 2),
                    we: pct(w.weightEquity, lang, 0),
                    wd: pct(w.weightDebt, lang, 0),
                    wacc: pct(w.wacc, lang, 2),
                  })}
            </p>
          )}
        </Panel>

        <Panel title={t.maker.terminalTitle}>
          <div role="radiogroup" aria-label={t.maker.terminalTitle} className="flex flex-wrap gap-4 text-sm">
            {(["gordon", "exit"] as const).map((k) => (
              <label key={k} className="inline-flex items-center gap-2 min-h-8">
                <input type="radio" name="terminal" checked={draft.terminal === k} onChange={() => set("terminal", k)} />
                {t.maker[k]}
              </label>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {draft.terminal === "gordon" ? (
              <NumberField label={t.maker.fields.terminalGrowth} value={draft.terminalGrowth} scale={100} suffix="%" onChange={(x) => set("terminalGrowth", x)} />
            ) : (
              <NumberField label={t.maker.fields.exitMultiple} value={draft.exitMultiple} digits={1} suffix="x" onChange={(x) => set("exitMultiple", x)} />
            )}
          </div>
          <label className="mt-3 inline-flex items-center gap-2 text-sm min-h-8">
            <input type="checkbox" checked={draft.midYear} onChange={(e) => set("midYear", e.target.checked)} />
            {t.maker.midYear}
          </label>
        </Panel>
      </div>

      {!a || !run ? (
        <Panel>
          <p role="status" className="text-sm text-warn">{t.maker.issues.badInputs}</p>
        </Panel>
      ) : !run.ok ? (
        <Panel>
          <p role="status" className="text-sm text-warn">{t.maker.issues[run.issue]}</p>
        </Panel>
      ) : (
        result && (
          <>
            <ResultCard r={result} price={base.price} terminal={a.terminal} implied={implied} years={a.growth.length} lang={lang} symbol={v.symbol} />
            <Projection r={result} lang={lang} />
            {sens && <Sensitivity s={sens} terminal={a.terminal} lang={lang} />}
          </>
        )
      )}

      <Panel title={t.maker.scenariosTitle}>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="dcf-scenario" className="text-[11px] text-muted">{t.maker.scenarioName}</label>
            <input
              id="dcf-scenario"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.maker.scenarioPlaceholder}
              maxLength={40}
              className="h-9 w-48 rounded-md border border-line bg-panel px-2 text-sm"
            />
          </div>
          <button type="submit" disabled={!result} className="h-11 sm:h-9 px-3.5 rounded-lg text-[13px] font-medium bg-accent text-accent-fg hover:brightness-110 disabled:opacity-50">
            {t.maker.save}
          </button>
          <button type="button" onClick={() => setDraft(m.defaults)} className="h-11 sm:h-9 px-3.5 rounded-lg text-[13px] font-medium border border-line bg-panel hover:bg-panel-2">
            {t.maker.reset}
          </button>
          <button type="button" onClick={csv} disabled={!result} className="h-11 sm:h-9 px-3.5 rounded-lg text-[13px] font-medium border border-line bg-panel hover:bg-panel-2 disabled:opacity-50">
            {t.maker.csv}
          </button>
        </form>
        {saved.length === 0 ? (
          <p className="mt-3 text-xs text-muted">{t.maker.noScenarios}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {saved.map((s) => {
              const r = runDcf(base, s.assumptions);
              return (
                <li key={s.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="font-medium">{s.name}</span>
                  <span className="num">{r.ok ? fmtPrice(r.result.perShare, lang) : "—"}</span>
                  {r.ok && (
                    <span className={`num text-xs ${r.result.upside >= 0 ? "text-up" : "text-down"}`}>
                      {r.result.upside >= 0 ? "+" : ""}
                      {pct(r.result.upside, lang)}
                    </span>
                  )}
                  <span className="text-[11px] text-muted">{fill(t.maker.savedOn, { d: fmtDate(s.savedAt.slice(0, 10), lang) })}</span>
                  <span className="ml-auto flex gap-2">
                    <button type="button" onClick={() => setDraft(s.assumptions)} className="h-8 px-2 rounded-md text-xs border border-line hover:bg-panel-2">
                      {t.maker.load}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = saved.filter((x) => x.name !== s.name);
                        setSaved(next);
                        writeSaved(v.symbol, next);
                      }}
                      className="h-8 px-2 rounded-md text-xs border border-line hover:bg-panel-2"
                    >
                      {t.maker.del}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="space-y-1 text-[11px] text-muted">
        {m.conventions.length > 0 && (
          <p>
            {t.maker.conventionsTitle} {m.conventions.map((c) => t.maker.conventions[c as keyof typeof t.maker.conventions] ?? c).join("; ")}.
          </p>
        )}
        <p>
          {fill(t.maker.defaultsNote, {
            c: m.data?.revenueCagr5 != null ? pct(m.data.revenueCagr5, lang) : "—",
            months: m.beta?.months ?? "—",
            rf: m.rf ? `${pct(m.rf.value, lang, 2)}, ${fmtDate(m.rf.date, lang)}` : "—",
            erp: m.erp ? pct(m.erp.value, lang, 2) : "—",
          })}
        </p>
        <p>{t.maker.model}</p>
        <p>{t.maker.disclaimer}</p>
      </div>
    </div>
  );
}

function ResultCard({
  r,
  price,
  terminal,
  implied,
  years,
  lang,
  symbol,
}: {
  symbol: string;
  r: MakerResult;
  price: number;
  terminal: "gordon" | "exit";
  implied: { g: number | null; bound: "below" | "above" | null } | null;
  years: number;
  lang: Lang;
}) {
  const { t } = useI18n();
  const up = r.upside >= 0;
  return (
    <Panel title={t.maker.resultTitle}>
      <div className="grid gap-4 md:grid-cols-2">
        <dl className="num text-sm space-y-1">
          {[
            [t.maker.result.pvFlows, money(r.pvFlows)],
            [fill(t.maker.result.pvTerminal, { p: pct(r.terminalShare, lang, 0) }), money(r.pvTerminal)],
            [t.maker.result.ev, money(r.ev)],
            [t.maker.result.netDebt, money(r.netDebt)],
            [t.maker.result.equity, money(r.equity)],
          ].map(([k, val]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-line py-1">
              <dt className="font-sans text-muted">{k}</dt>
              <dd>{val}</dd>
            </div>
          ))}
        </dl>
        <div>
          <p className="text-xs text-muted">{t.maker.result.perShare}</p>
          <p className="num text-3xl font-semibold" aria-live="polite">{fmtPrice(r.perShare, lang)}</p>
          <p className={`num text-sm ${up ? "text-up" : "text-down"}`}>
            {up ? "+" : ""}
            {pct(r.upside, lang)} <span className="text-muted font-sans">{fill(t.maker.result.vsPrice, { price: fmtPrice(price, lang) })}</span>
          </p>
          <p className="mt-2 text-xs text-muted">
            {terminal === "gordon"
              ? fill(t.maker.result.impliedMultiple, { m: `${fmtNum(r.impliedExitMultiple, lang, 1)}x` })
              : fill(t.maker.result.impliedGrowth, { g: pct(r.impliedTerminalGrowth, lang, 2) })}
          </p>
          {implied && (
            <p className="mt-2 text-sm">
              {implied.g !== null
                ? fill(t.maker.result.impliedRevenue, { g: pct(implied.g, lang), n: years })
                : implied.bound === "above"
                  ? t.maker.result.impliedAbove
                  : implied.bound === "below"
                    ? t.maker.result.impliedBelow
                    : null}
            </p>
          )}
          <UseAsFairValue key={r.perShare.toFixed(2)} symbol={symbol} value={r.perShare} price={price} />
        </div>
      </div>
    </Panel>
  );
}

/** Saves the DCF's value per share as the user's fair value (recorded as "from the DCF"). */
function UseAsFairValue({ symbol, value, price }: { symbol: string; value: number; price: number }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  if (!(value > 0)) return null;
  const save = async () => {
    setState("saving");
    const r = await saveNote(symbol, { fairValue: Math.round(value * 100) / 100, fairValueSource: "dcf", price, baseUpdatedAt: null });
    setState(r.ok ? "saved" : "failed");
  };
  return (
    <div className="mt-3">
      <button type="button" onClick={save} disabled={state === "saving"} className={buttonClass("secondary", true)}>
        {t.research.useDcf}
      </button>
      {state === "saved" && <p className="mt-2 text-xs text-muted" role="status">{t.research.usedDcf}</p>}
      {state === "failed" && <StatusMessage tone="warn" className="mt-2">{t.research.saveFailed}</StatusMessage>}
    </div>
  );
}

function Projection({ r, lang }: { r: MakerResult; lang: Lang }) {
  const { t } = useI18n();
  const rows: [string, (y: MakerResult["years"][number]) => string, boolean?][] = [
    [t.maker.proj.revenue, (y) => money(y.revenue)],
    [t.maker.proj.ebit, (y) => money(y.ebit)],
    [t.maker.proj.nopat, (y) => money(y.nopat)],
    [t.maker.proj.da, (y) => money(y.da)],
    [t.maker.proj.capex, (y) => money(y.capex)],
    [t.maker.proj.dNwc, (y) => money(y.dNwc)],
    [t.maker.proj.fcff, (y) => money(y.fcff), true],
    [t.maker.proj.factor, (y) => fmtNum(y.factor, lang, 3)],
    [t.maker.proj.pv, (y) => money(y.pv), true],
  ];
  return (
    <Panel title={t.maker.projTitle}>
      <div className="relative overflow-x-auto -mx-4" tabIndex={0} aria-label={t.maker.projTitle}>
        <table className="num text-sm w-max min-w-full border-separate border-spacing-0">
          <caption className="sr-only">{t.maker.projTitle}</caption>
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="sticky left-0 z-10 bg-panel pl-4 pr-3 pb-2">
                <span className="sr-only">{t.maker.item}</span>
              </th>
              {r.years.map((y) => (
                <th key={y.t} scope="col" className="text-right font-normal px-3 pb-2">{fill(t.maker.year, { n: y.t })}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, f, strong]) => (
              <tr key={label} className="border-t border-line">
                <th scope="row" className={`sticky left-0 z-10 bg-panel text-left font-sans pl-4 pr-3 py-1 text-xs ${strong ? "font-semibold" : "font-normal text-muted"}`}>
                  {label}
                </th>
                {r.years.map((y) => (
                  <td key={y.t} className={`text-right px-3 ${strong ? "font-semibold" : ""}`}>{f(y)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Sensitivity({ s, terminal, lang }: { s: ReturnType<typeof sensitivity>; terminal: "gordon" | "exit"; lang: Lang }) {
  const { t } = useI18n();
  const colLabel = terminal === "gordon" ? t.maker.sensColsGordon : t.maker.sensColsExit;
  return (
    <Panel title={t.maker.sensTitle}>
      <div className="relative overflow-x-auto -mx-4" tabIndex={0} aria-label={t.maker.sensTitle}>
        <table className="num text-sm w-max min-w-full">
          <caption className="sr-only">{`${t.maker.sensTitle}: ${t.maker.sensRows} × ${colLabel}`}</caption>
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="text-left font-normal pl-4 pr-3 pb-2">{`${t.maker.sensRows} \\ ${colLabel}`}</th>
              {s.seconds.map((x, j) => (
                <th key={j} scope="col" className="text-right font-normal px-3 pb-2">
                  {terminal === "gordon" ? pct(x, lang, 2) : `${fmtNum(x, lang, 1)}x`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.grid.map((row, i) => (
              <tr key={i} className="border-t border-line">
                <th scope="row" className="text-left font-normal text-muted pl-4 pr-3 py-1">{pct(s.waccs[i], lang, 2)}</th>
                {row.map((val, j) => (
                  <td key={j} className={`text-right px-3 ${i === 2 && j === 2 ? "font-semibold bg-panel-2" : ""}`}>
                    {val === null ? "—" : fmtPrice(val, lang)}
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
