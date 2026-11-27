"use client";

import { Suspense, useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { DeepI18n, fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtNum, fmtPrice } from "@/lib/format";
import { fairValueHistory, rebaseForm, upside, type ResearchNote } from "@/lib/research";
import { saveNote, useNote, type SaveIssue } from "@/lib/researchClient";
import { useTrades } from "@/lib/tradesClient";
import PushSettings from "../PushSettings";
import DatedNotes from "./DatedNotes";
import ListingNotice from "./ListingNotice";
import { IssueNote, Panel, Skeleton, StatusMessage, buttonClass } from "../ui";
import { NumberField } from "../valuation/fields";
import { PlanControls, PlanPreview, ThesisHistory, ThesisSummary, WatchEditor, type DraftCheck, type WatchValue } from "./Thesis";
import { isWatched } from "@/lib/thesis";
import type { Direction } from "@/lib/thesis";

// The guided plan loads with its text (deep dictionary) only when it's shown.
const PlanBuilder = dynamic(() => import("./PlanBuilder"), { loading: () => <Skeleton className="h-96 w-full rounded-lg" /> });
const TradesPanel = dynamic(() => import("./TradesPanel"), { loading: () => <Skeleton className="h-40 w-full rounded-lg" /> });

/** The trades logged for this stock, with its text from the deep dictionary. */
function Trades(props: { symbol: string; price: number | null; note: ResearchNote }) {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full rounded-lg" />}>
      <DeepI18n>
        <TradesPanel {...props} />
      </DeepI18n>
    </Suspense>
  );
}

/** Remembered per device: someone who chose to write the plan by hand starts from the form next time. */
const MODE_KEY = "iep.planMode";

type Lang = "es" | "en";

interface Form {
  thesis: string;
  bull: string;
  bear: string;
  fairValue: number | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  direction: Direction;
  reviewBy: string | null;
  checks: DraftCheck[];
}
const formOf = (n: ResearchNote): Form => ({
  thesis: n.thesis,
  bull: n.bull,
  bear: n.bear,
  fairValue: n.fairValue,
  entry: n.entry,
  stop: n.stop,
  target: n.target,
  direction: n.direction,
  reviewBy: n.reviewBy,
  checks: n.checks,
});
const same = (a: Form, b: Form) => (Object.keys(a) as (keyof Form)[]).every((k) => (k === "checks" ? JSON.stringify(a[k]) === JSON.stringify(b[k]) : a[k] === b[k]));

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
  // A notebook with nothing in it opens on the guided plan, unless this device chose the form.
  const [mode, setMode] = useState<"guided" | "form">(() => {
    // "Set an exit" from the portfolio opens the guide even on a notebook with text in it.
    if (!note.closed && new URLSearchParams(window.location.search).get("plan") === "1") return "guided";
    if (isWatched(note) || note.closed || note.thesis || note.bull || note.bear) return "form";
    try {
      return localStorage.getItem(MODE_KEY) === "form" ? "form" : "guided";
    } catch {
      return "guided";
    }
  });
  const [planned, setPlanned] = useState(false);
  const plannedRef = useRef<HTMLDivElement>(null);
  // One task at a time: until the notebook is saved, only the plan shows. Trades and dated notes
  // come after, or right away for a stock already held (trades logged before there was a thesis).
  const trades = useTrades();
  const holds = trades.state.status === "ok" && trades.state.data.some((x) => x.symbol === symbol);
  const started = note.updatedAt !== null || holds;
  // After the guided plan saves, show its confirmation where the eye is.
  useEffect(() => {
    if (planned) plannedRef.current?.scrollIntoView({ block: "center" });
  }, [planned]);
  const choose = (m: "guided" | "form") => {
    setMode(m);
    setPlanned(false);
    try {
      if (m === "form") localStorage.setItem(MODE_KEY, "form");
      else localStorage.removeItem(MODE_KEY);
    } catch {
      /* blocked storage: the choice lasts for this visit */
    }
  };
  const [form, setForm] = useState<Form>(() => formOf(note));
  const [base, setBase] = useState<Form>(() => formOf(note));
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "error"; issue: SaveIssue }>({ kind: "idle" });
  const dirty = !same(form, base);

  // A newer saved version (another tab, a note, the DCF button): fields without unsaved edits take it.
  useEffect(() => {
    const saved = formOf(note);
    if (same(base, saved)) return;
    setForm((f) => rebaseForm(f, base, saved));
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
    const checks = form.checks.map((c) => {
      const { createdAt: _skip, ...rest } = c as DraftCheck & { createdAt?: string };
      return rest;
    });
    const r = await saveNote(symbol, { ...form, checks, fairValueSource: "manual", price, baseUpdatedAt: note.updatedAt });
    if (r.ok) {
      setBase(formOf(r.note));
      setForm(formOf(r.note));
      setStatus({ kind: "idle" });
    } else setStatus({ kind: "error", issue: r.error });
  };

  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const field = "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm leading-relaxed placeholder:text-muted focus:border-line-strong";

  if (mode === "guided") {
    return (
      <div className="space-y-4">
        <ListingNotice symbol={symbol} />
        <Suspense fallback={<Skeleton className="h-96 w-full rounded-lg" />}>
          <DeepI18n>
            <PlanBuilder
              symbol={symbol}
              note={note}
              price={price}
              onSaved={() => {
                setMode("form");
                setPlanned(true);
              }}
              onManual={() => choose("form")}
              onReload={onReload}
            />
          </DeepI18n>
        </Suspense>
        {started && <Trades symbol={symbol} price={price} note={note} />}
        {started && <DatedNotes symbol={symbol} note={note} />}
        <p className="text-xs text-muted">{R.disclaimer}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ListingNotice symbol={symbol} />
      {planned && (
        <div ref={plannedRef} className="space-y-2">
          <StatusMessage tone="info">{R.planSaved}</StatusMessage>
          <PushSettings variant="prompt" />
        </div>
      )}
      {(isWatched(note) || note.closed) && <ThesisSummary symbol={symbol} note={note} price={price} />}
      {!note.closed && (
        <p>
          <button type="button" onClick={() => choose("guided")} className="link inline-flex min-h-11 items-center text-sm sm:min-h-0">
            {isWatched(note) ? R.planRedo : R.planGuided}
          </button>
        </p>
      )}
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

        <Panel title={t.thesis.plan} description={t.thesis.planIntro}>
          <PlanControls direction={form.direction} reviewBy={form.reviewBy} onChange={(v) => setForm((f) => ({ ...f, ...v }))} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumberField label={R.fairValue} value={form.fairValue} onChange={set("fairValue")} suffix="$" />
            <NumberField label={R.entry} value={form.entry} onChange={set("entry")} suffix="$" />
            <NumberField label={R.stop} value={form.stop} onChange={set("stop")} suffix="$" />
            <NumberField label={R.target} value={form.target} onChange={set("target")} suffix="$" />
          </div>
          {price !== null && form.entry === null && (
            <button type="button" className="link mt-1 inline-flex min-h-11 items-center text-xs sm:min-h-0 sm:py-1" onClick={() => set("entry")(Math.round(price * 100) / 100)}>
              {fill(t.thesis.usePrice, { p: fmtPrice(price, lang) })}
            </button>
          )}
          <PlanPreview plan={form} price={price} />
          <PlanSummary form={form} price={price} lang={lang} />
        </Panel>

        <WatchEditor value={{ direction: form.direction, reviewBy: form.reviewBy, checks: form.checks }} onChange={(w: WatchValue) => setForm((f) => ({ ...f, ...w }))} />

        <div className="sticky bottom-16 md:bottom-3 z-20 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3 shadow-pop">
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

      {started && <Trades symbol={symbol} price={price} note={note} />}
      {started && <DatedNotes symbol={symbol} note={note} />}
      <ThesisHistory symbol={symbol} note={note} />
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

/** Risk against reward from the entry, when the plan has all three levels (the preview covers the rest). */
function PlanSummary({ form, lang }: { form: Form; price: number | null; lang: Lang }) {
  const { t } = useI18n();
  const { entry, stop, target } = form;
  if (!(entry && stop && target && entry > stop && target > entry)) return null;
  return <p className="mt-3 text-sm text-muted">{fill(t.research.riskReward, { r: fmtNum((target - entry) / (entry - stop), lang, 1) })}</p>;
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
