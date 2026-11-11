"use client";

import { useEffect, useId, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtNum, fmtPrice } from "@/lib/format";
import { fairValueHistory, upside, type ResearchNote } from "@/lib/research";
import { saveNote, useNote, type SaveIssue } from "@/lib/researchClient";
import { TrashIcon } from "../icons";
import { IssueNote, Panel, Skeleton, StatusMessage, buttonClass } from "../ui";
import { NumberField } from "../valuation/fields";

type Lang = "es" | "en";

interface Form {
  thesis: string;
  bull: string;
  bear: string;
  fairValue: number | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
}
const formOf = (n: ResearchNote): Form => ({ thesis: n.thesis, bull: n.bull, bear: n.bear, fairValue: n.fairValue, entry: n.entry, stop: n.stop, target: n.target });
const same = (a: Form, b: Form) => (Object.keys(a) as (keyof Form)[]).every((k) => a[k] === b[k]);

export const signedPct = (v: number, lang: Lang) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(v) * 100, lang, 1)}%`;

/** "My research" tab: thesis, bull and bear points, fair value and plan, dated notes. */
export default function ResearchPanel({ symbol, price }: { symbol: string; price: number | null }) {
  const { t } = useI18n();
  const { state, retry } = useNote(symbol);
  if (state.status === "error") {
    return (
      <Panel title={t.research.title}>
        <IssueNote issue={state.issue} onRetry={retry} />
      </Panel>
    );
  }
  const shown = state.status === "ok" ? state.data : state.previous?.data;
  if (!shown) {
    return (
      <Panel title={t.research.title}>
        <p role="status" className="sr-only">{t.ux.loading}</p>
        <Skeleton className="h-64 w-full rounded-lg" />
      </Panel>
    );
  }
  return <Notebook symbol={symbol} note={shown} price={price} onReload={retry} />;
}

function Notebook({ symbol, note, price, onReload }: { symbol: string; note: ResearchNote; price: number | null; onReload: () => void }) {
  const { t, lang } = useI18n();
  const R = t.research;
  const [form, setForm] = useState<Form>(() => formOf(note));
  const [base, setBase] = useState<Form>(() => formOf(note));
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "error"; issue: SaveIssue }>({ kind: "idle" });
  const dirty = !same(form, base);

  // A newer saved version (another tab, a note, the DCF button): take it unless the form has unsaved edits.
  useEffect(() => {
    const saved = formOf(note);
    if (same(base, saved)) return;
    setForm((f) => (same(f, base) ? saved : f));
    setBase(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when a new version arrives; `base` is read as of that render
  }, [note]);

  // Don't lose unsaved text when leaving the page.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = async () => {
    if (!dirty || status.kind === "saving") return;
    setStatus({ kind: "saving" });
    const r = await saveNote(symbol, { ...form, fairValueSource: "manual", price, baseUpdatedAt: note.updatedAt });
    if (r.ok) {
      setBase(formOf(r.note));
      setForm(formOf(r.note));
      setStatus({ kind: "idle" });
    } else setStatus({ kind: "error", issue: r.error });
  };

  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const field = "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm leading-relaxed placeholder:text-muted focus:border-line-strong";

  return (
    <div className="space-y-4">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            save();
          }
        }}
      >
        <Panel title={R.title} description={fill(R.intro, { s: symbol })} id="research">
          <div className="space-y-4">
            <TextArea label={R.thesis} hint={R.thesisHint} value={form.thesis} onChange={set("thesis")} rows={3} className={field} />
            <div className="grid gap-4 md:grid-cols-2">
              <TextArea label={R.bull} hint={R.pointsHint} value={form.bull} onChange={set("bull")} rows={5} className={field} />
              <TextArea label={R.bear} hint={R.pointsHint} value={form.bear} onChange={set("bear")} rows={5} className={field} />
            </div>
          </div>
        </Panel>

        <Panel title={R.plan}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumberField label={R.fairValue} value={form.fairValue} onChange={set("fairValue")} suffix="$" />
            <NumberField label={R.entry} value={form.entry} onChange={set("entry")} suffix="$" />
            <NumberField label={R.stop} value={form.stop} onChange={set("stop")} suffix="$" />
            <NumberField label={R.target} value={form.target} onChange={set("target")} suffix="$" />
          </div>
          <PlanSummary form={form} price={price} lang={lang} />
        </Panel>

        <div className="sticky bottom-16 md:bottom-3 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel/95 px-4 py-3 backdrop-blur">
          <button type="submit" disabled={!dirty || status.kind === "saving"} className={buttonClass("primary", true)} aria-keyshortcuts="Control+S Meta+S">
            {status.kind === "saving" ? R.saving : R.save}
          </button>
          <p className="text-xs text-muted" role="status">
            {status.kind === "error" ? null : dirty ? R.unsaved : note.updatedAt ? fill(R.saved, { t: fmtAsOf(note.updatedAt, lang) }) : R.notSaved}
          </p>
          {status.kind === "error" && (
            <StatusMessage
              tone="warn"
              className="basis-full"
              action={
                status.issue === "conflict" ? (
                  <button type="button" onClick={onReload} className={buttonClass("secondary", true)}>
                    {R.reload}
                  </button>
                ) : undefined
              }
            >
              {status.issue === "conflict" ? R.conflict : status.issue === "invalid" ? R.invalid : status.issue === "beta_expired" ? t.data.betaExpired : R.saveFailed}
            </StatusMessage>
          )}
        </div>
      </form>

      <DatedNotes symbol={symbol} note={note} />
      <FairValueHistory note={note} lang={lang} />
      <p className="text-xs text-muted">{R.disclaimer}</p>
    </div>
  );
}

function TextArea({ label, hint, value, onChange, rows, className }: { label: string; hint: string; value: string; onChange: (v: string) => void; rows: number; className: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <p id={`${id}-hint`} className="text-xs text-muted mb-1.5">
        {hint}
      </p>
      <textarea id={id} aria-describedby={`${id}-hint`} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} maxLength={4000} className={className} />
    </div>
  );
}

/** Where the price sits against the user's own numbers, in words. */
function PlanSummary({ form, price, lang }: { form: Form; price: number | null; lang: Lang }) {
  const { t } = useI18n();
  const R = t.research;
  const lines: string[] = [];
  const up = upside(form.fairValue, price);
  if (up !== null) lines.push(`${R.fairValue}: ${up >= 0 ? fill(R.above, { p: signedPct(up, lang).replace("+", "") }) : fill(R.below, { p: signedPct(-up, lang).replace("+", "") })}`);
  for (const k of ["stop", "target"] as const) {
    const d = upside(form[k], price);
    if (d !== null) lines.push(`${R[k]}: ${fill(R.fromPrice, { p: signedPct(d, lang) })}`);
  }
  const { entry, stop, target } = form;
  if (entry && stop && target && entry > stop && target > entry) lines.push(fill(R.riskReward, { r: fmtNum((target - entry) / (entry - stop), lang, 1) }));
  if (lines.length === 0) return null;
  return (
    <ul className="mt-4 space-y-1 text-sm text-muted">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

function DatedNotes({ symbol, note }: { symbol: string; note: ResearchNote }) {
  const { t, lang } = useI18n();
  const R = t.research;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const id = useId();
  const notes = note.log.filter((e) => e.kind === "note");
  const run = async (input: { addNote?: string; removeNote?: string }) => {
    setBusy(true);
    setFailed(false);
    const r = await saveNote(symbol, { ...input, baseUpdatedAt: note.updatedAt });
    setBusy(false);
    if (!r.ok) setFailed(true);
    else if (input.addNote) setText("");
  };
  return (
    <Panel title={R.log}>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) run({ addNote: text });
        }}
      >
        <div className="flex-1">
          <label htmlFor={id} className="control-label mb-1.5 block">
            {R.noteLabel}
          </label>
          <input
            id={id}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            placeholder={R.notePlaceholder}
            className="h-11 sm:h-9 w-full rounded-lg border border-line bg-panel px-3 text-sm placeholder:text-muted"
          />
        </div>
        <button type="submit" disabled={busy || !text.trim()} className={buttonClass("secondary", true)}>
          {R.addNote}
        </button>
      </form>
      {failed && <StatusMessage tone="warn" className="mt-2">{R.saveFailed}</StatusMessage>}
      {notes.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{R.noNotes}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {notes.map((e) => (
            <li key={e.id} className="flex items-start gap-3 py-2.5">
              <time dateTime={e.at} className="num w-28 shrink-0 pt-0.5 text-xs text-muted">
                {fmtAsOf(e.at, lang)}
              </time>
              <p className="flex-1 min-w-0 whitespace-pre-wrap break-words text-sm">{e.kind === "note" ? e.text : null}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => run({ removeNote: e.id })}
                className="-my-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted hover:bg-panel-2 hover:text-fg"
                aria-label={fill(R.deleteNote, { d: fmtAsOf(e.at, lang) })}
              >
                <TrashIcon size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FairValueHistory({ note, lang }: { note: ResearchNote; lang: Lang }) {
  const { t } = useI18n();
  const R = t.research;
  const rows = fairValueHistory(note).reverse(); // newest first
  if (rows.length === 0) return null;
  return (
    <Panel title={R.history}>
      <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={R.history}>
        <table className="num w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="py-1.5 pr-3 text-left font-normal">{R.historyCols.date}</th>
              <th scope="col" className="py-1.5 px-2 text-right font-normal">{R.historyCols.value}</th>
              <th scope="col" className="py-1.5 px-2 text-right font-normal">{R.historyCols.price}</th>
              <th scope="col" className="py-1.5 pl-2 text-left font-normal">{R.historyCols.source}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const gap = upside(e.value, e.price);
              return (
                <tr key={e.id} className="border-t border-line">
                  <td className="py-2 pr-3 text-muted">{fmtAsOf(e.at, lang)}</td>
                  <td className="py-2 px-2 text-right font-medium">{e.value === null ? R.cleared : fmtPrice(e.value, lang)}</td>
                  <td className="py-2 px-2 text-right">
                    {e.price === null ? "—" : fmtPrice(e.price, lang)}
                    {gap !== null && <span className="ml-1.5 text-xs text-muted">({signedPct(gap, lang)})</span>}
                  </td>
                  <td className="py-2 pl-2 text-muted">{R.sources[e.source]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
