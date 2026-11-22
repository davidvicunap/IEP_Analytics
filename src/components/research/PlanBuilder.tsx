"use client";

// The guided plan (My research tab, for a notebook without a plan yet): three short steps built on
// the stock's own data, then a review. Every suggestion says why it was suggested; the user picks
// or types each value, and saving creates a watched thesis. Text: `plan` in the deep dictionary.
import Link from "next/link";
import { Suspense, use, useEffect, useId, useMemo, useRef, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { capitalInUsd, useFx } from "@/lib/fxClient";
import { fmtMoney } from "@/lib/money";
import { keyLevels } from "@/lib/levels";
import { RISK_PCTS, addLines, positionSize, reasonsFrom, removeLines, reviewOptions, stopOptions, targetOptions, type LevelOption } from "@/lib/planBuilder";
import type { ResearchNote } from "@/lib/research";
import { saveNote, type SaveIssue } from "@/lib/researchClient";
import { riskStore, useRisk } from "@/lib/riskClient";
import { track } from "@/lib/track";
import type { Direction } from "@/lib/thesis";
import type { Candle, Result } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import type { EarningsPayload } from "@/lib/earningsData";
import type { VerdictPoint } from "@/lib/verdict";
import type { VerdictPayload } from "@/lib/verdictData";
import { Mark, verdictEvidence } from "../AtAGlance";
import { CheckIcon } from "../icons";
import { Explain, IssueNote, Panel, Segmented, Skeleton, StatusMessage, buttonClass } from "../ui";
import { NumberField } from "../valuation/fields";
import MoneySettings from "../portfolio/MoneySettings";
import { PlanPreview } from "./Thesis";

type Lang = "es" | "en";
type Dict = ReturnType<typeof useI18n>["t"];

export interface Draft {
  thesis: string;
  bull: string;
  bear: string;
  direction: Direction;
  entry: number | null;
  stop: number | null;
  target: number | null;
  fairValue: number | null;
  reviewBy: string | null;
}

const STEPS = ["why", "levels", "size", "review"] as const;
const cents = (v: number) => Math.round(v * 100) / 100;
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const pctText = (v: number, lang: Lang) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(v) * 100, lang, 1)}%`;

export default function PlanBuilder({
  symbol,
  note,
  price,
  history,
  onSaved,
  onManual,
  onReload,
}: {
  symbol: string;
  note: ResearchNote;
  price: number | null;
  history: Promise<Result<Candle[]>> | null;
  onSaved: () => void;
  onManual: () => void;
  onReload: () => void;
}) {
  const { t, lang } = useI18n();
  const P = t.plan;
  const R = t.research;
  // From "Set an exit" (?plan=1) the guide opens on the levels.
  const [step, setStep] = useState(() => (new URLSearchParams(window.location.search).get("plan") === "1" ? 1 : 0));
  const [draft, setDraft] = useState<Draft>(() => ({
    thesis: note.thesis,
    bull: note.bull,
    bear: note.bear,
    direction: note.direction,
    entry: note.entry ?? (price ? cents(price) : null),
    stop: note.stop,
    target: note.target,
    fairValue: note.fairValue,
    reviewBy: note.reviewBy,
  }));
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "error"; issue: SaveIssue }>({ kind: "idle" });
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  // Moving between steps puts focus on the new step's title (screen readers hear where they are).
  useEffect(() => {
    if (moved.current) heading.current?.focus();
  }, [step]);
  const go = (n: number) => {
    moved.current = true;
    setStep(n);
  };
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const watchable = draft.stop !== null || draft.target !== null || draft.fairValue !== null || draft.reviewBy !== null || note.checks.length > 0;

  const save = async () => {
    if (status.kind === "saving") return;
    setStatus({ kind: "saving" });
    const r = await saveNote(symbol, { ...draft, fairValueSource: "manual", price, baseUpdatedAt: note.updatedAt });
    if (r.ok) {
      setStatus({ kind: "idle" });
      if (watchable) track("plan_saved");
      onSaved();
    } else setStatus({ kind: "error", issue: r.error });
  };

  const titles = [fill(P.whyTitle, { s: symbol }), P.levelsTitle, P.sizeTitle, P.reviewStepTitle];
  return (
    <Panel
      title={P.title}
      description={
        <>
          {fill(P.intro, { s: symbol })}{" "}
          <button type="button" onClick={onManual} className="link inline-flex min-h-11 items-center sm:min-h-0">
            {P.manual}
          </button>
        </>
      }
      id="plan-builder"
    >
      <ol aria-label={P.stepsLabel} className="mb-5 grid grid-cols-4 gap-1.5">
        {STEPS.map((k, i) => (
          <li key={k}>
            <button type="button" onClick={() => go(i)} aria-current={i === step ? "step" : undefined} className="group flex w-full min-h-11 flex-col items-start gap-1.5 text-left">
              <span className={`block h-1 w-full rounded-full ${i <= step ? "bg-fg" : "bg-line-strong"}`} aria-hidden="true" />
              <span className={`inline-flex items-center gap-1 text-xs leading-tight ${i === step ? "font-medium text-fg" : "text-muted group-hover:text-fg"}`}>
                {/* Three steps, then the review (a check, not a fourth step). */}
                {k === "review" ? <CheckIcon size={12} /> : `${i + 1}.`}
                <span className="sr-only sm:not-sr-only">{P.steps[k]}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      {step < 3 && <p className="text-xs text-muted">{fill(P.stepOf, { n: step + 1, t: 3 })}</p>}
      <h3 ref={heading} tabIndex={-1} className="mb-4 text-lg font-semibold outline-none">
        {titles[step]}
      </h3>

      {step === 0 && <WhyStep symbol={symbol} draft={draft} set={set} />}
      {step === 1 && <LevelsStep symbol={symbol} draft={draft} set={set} price={price} history={history} />}
      {step === 2 && <SizeStep draft={draft} />}
      {step === 3 && (
        <div className="space-y-4">
          <Summary draft={draft} />
          <PlanPreview plan={draft} price={price} />
          {!watchable && <StatusMessage tone="warn">{P.nothingWatched}</StatusMessage>}
          {status.kind === "error" && (
            <StatusMessage
              tone="warn"
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
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {step > 0 && (
          <button type="button" onClick={() => go(step - 1)} className={buttonClass("secondary", true)}>
            {P.back}
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={() => go(step + 1)} className={buttonClass("primary", true)}>
            {P.next}
          </button>
        ) : (
          <button type="button" onClick={save} disabled={status.kind === "saving"} className={buttonClass("primary", true)}>
            {status.kind === "saving" ? R.saving : watchable ? P.save : P.saveOnly}
          </button>
        )}
        {step === 2 && (
          <button type="button" onClick={() => go(3)} className="link inline-flex min-h-11 items-center text-sm sm:min-h-0">
            {P.skip}
          </button>
        )}
      </div>
    </Panel>
  );
}

type Setter = <K extends keyof Draft>(k: K) => (v: Draft[K]) => void;

// ---- Step 1: why ------------------------------------------------------------------------------

function WhyStep({ symbol, draft, set }: { symbol: string; draft: Draft; set: Setter }) {
  const { t } = useI18n();
  const P = t.plan;
  const T = t.thesis;
  return (
    <div className="space-y-5">
      <div>
        <p className="control-label mb-1.5">{T.direction}</p>
        <Segmented label={T.direction} value={draft.direction} onChange={set("direction")} options={(["up", "down"] as const).map((d) => ({ value: d, label: T.directions[d] }))} />
      </div>
      <TextField label={P.thesisLabel} hint={P.thesisHint} value={draft.thesis} onChange={set("thesis")} rows={2} />
      <Reasons symbol={symbol} draft={draft} set={set} />
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label={P.bullLabel} value={draft.bull} onChange={set("bull")} rows={4} />
        <TextField label={P.bearLabel} value={draft.bear} onChange={set("bear")} rows={4} />
      </div>
    </div>
  );
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

function Reasons({ symbol, draft, set }: { symbol: string; draft: Draft; set: Setter }) {
  const { t, lang } = useI18n();
  const P = t.plan;
  const G = t.glance;
  const { state, retry } = useResource<VerdictPayload>(`/api/verdict/${encodeURIComponent(symbol)}`, { shared: true });

  let body: React.ReactNode;
  if (state.status === "loading") {
    body = (
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
      </div>
    );
  } else if (state.status === "error") {
    body = (
      <div className="space-y-2">
        <IssueNote issue={state.issue} onRetry={retry} />
        <p className="text-sm text-muted">{P.dataMissing}</p>
      </div>
    );
  } else {
    const v = state.data;
    const { for: pro, against } = reasonsFrom(v.points, draft.direction);
    const source = (p: VerdictPoint) => (p.key === "valuation" ? (v.priceAt ? fill(P.srcPrice, { d: fmtDate(v.priceAt, lang) }) : "") : v.fiscal ? fill(P.srcSec, { fy: v.fiscal }) : "SEC");
    const sentence = (p: VerdictPoint) => (p.note === "negativeEquity" ? G.lines.debt.negativeEquity : G.lines[p.key][p.level]);
    const line = (p: VerdictPoint) => `${sentence(p)} (${[verdictEvidence(p, G, lang), source(p)].filter(Boolean).join("; ")})`;
    const group = (title: string, empty: string, points: VerdictPoint[], k: "bull" | "bear") => {
      const text = draft[k];
      const have = new Set(text.split("\n").map(norm));
      return (
        <div>
          <p className="mb-1.5 text-sm font-medium">{title}</p>
          {points.length === 0 ? (
            <p className="text-sm text-muted">{empty}</p>
          ) : (
            <ul className="space-y-1.5">
              {points.map((p) => {
                const l = line(p);
                const on = have.has(norm(l));
                return (
                  <li key={p.key}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => set(k)(on ? removeLines(text, [l]) : addLines(text, [l]))}
                      className={`flex w-full min-h-11 items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${on ? "border-fg bg-panel-2" : "border-line hover:bg-panel-2"}`}
                    >
                      <Mark level={p.level} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-snug">{sentence(p)}</span>
                        <span className="num mt-0.5 block text-xs text-muted">{verdictEvidence(p, G, lang)}</span>
                      </span>
                      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${on ? "border-fg bg-fg text-bg" : "border-line-strong"}`} aria-hidden="true">
                        {on && <CheckIcon size={12} />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      );
    };
    body = (
      <div className="grid gap-4 md:grid-cols-2">
        {group(P.forTitle, P.noneFor, pro, "bull")}
        {group(P.againstTitle, P.noneAgainst, against, "bear")}
      </div>
    );
  }
  return (
    <section aria-labelledby="plan-data-title">
      <h4 id="plan-data-title" className="text-sm font-semibold">
        {P.dataTitle}
      </h4>
      <p className="mb-3 text-xs text-muted">{P.dataHint}</p>
      {body}
    </section>
  );
}

// ---- Step 2: what would change your mind -----------------------------------------------------------

function LevelsStep({ symbol, draft, set, price, history }: { symbol: string; draft: Draft; set: Setter; price: number | null; history: Promise<Result<Candle[]>> | null }) {
  const { t, lang } = useI18n();
  const P = t.plan;
  const R = t.research;
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">{P.levelsIntro}</p>
      <Explain className="-mt-4">{P.levelsHow}</Explain>
      <div className="flex flex-wrap items-end gap-3">
        <NumberField label={R.entry} value={draft.entry} onChange={set("entry")} suffix="$" className="w-40" />
        {price !== null && draft.entry !== cents(price) && (
          <button type="button" className="link inline-flex min-h-11 items-center text-xs sm:min-h-9" onClick={() => set("entry")(cents(price))}>
            {fill(P.entryHint, { p: fmtPrice(price, lang) })}
          </button>
        )}
      </div>
      <Suspense
        fallback={
          <div className="space-y-2" aria-hidden="true">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        }
      >
        <LevelPickers draft={draft} set={set} history={history} />
      </Suspense>
      <div>
        <p className="text-sm font-medium">{P.fairValueTitle}</p>
        <p className="mb-1.5 text-xs text-muted">
          {P.fairValueHint}{" "}
          <Link href={`/stock/${encodeURIComponent(symbol)}?tab=valuation&view=dcf`} prefetch={false} className="link">
            {P.dcfLink}
          </Link>
        </p>
        <NumberField label={R.fairValue} value={draft.fairValue} onChange={set("fairValue")} suffix="$" className="w-40" />
      </div>
      <ReviewPicker symbol={symbol} value={draft.reviewBy} onChange={set("reviewBy")} />
      <PlanPreview plan={draft} price={price} />
    </div>
  );
}

function LevelPickers({ draft, set, history }: { draft: Draft; set: Setter; history: Promise<Result<Candle[]>> | null }) {
  const { t, lang } = useI18n();
  const P = t.plan;
  const R = t.research;
  const h = history ? use(history) : null;
  const levels = useMemo(() => (h?.ok && h.data.length ? keyLevels(h.data) : null), [h]);
  const entry = draft.entry ?? 0;
  const stops = useMemo(() => stopOptions(levels, entry, draft.direction), [levels, entry, draft.direction]);
  const targets = useMemo(() => targetOptions(levels, entry, draft.direction, draft.fairValue), [levels, entry, draft.direction, draft.fairValue]);
  return (
    <>
      {h && !h.ok && <IssueNote issue={h.error} />}
      {h?.ok && !stops.length && !targets.length && <p className="text-sm text-muted">{P.noLevels}</p>}
      <LevelChoice title={P.stopTitle} label={R.stop} value={draft.stop} options={stops} describe={(o) => basisText(o, "stop", P, lang)} onChange={set("stop")} />
      <LevelChoice title={P.targetTitle} label={R.target} value={draft.target} options={targets} describe={(o) => basisText(o, "target", P, lang)} onChange={set("target")} />
    </>
  );
}

function basisText(o: LevelOption, role: "stop" | "target", P: Dict["plan"], lang: Lang): string {
  const b = o.basis;
  const p = "price" in b ? fmtPrice(b.price, lang) : "";
  switch (b.kind) {
    case "zone":
      return fill(role === "stop" ? (b.side === "support" ? P.basis.stopSupport : P.basis.stopResistance) : b.side === "resistance" ? P.basis.targetResistance : P.basis.targetSupport, { p, n: b.touches });
    case "atr":
      return fill(P.basis.atr, { m: b.multiple, a: fmtPrice(b.atr, lang) });
    case "low52":
      return role === "stop" ? fill(P.basis.stopLow52, { p }) : P.basis.low52;
    case "high52":
      return role === "stop" ? fill(P.basis.stopHigh52, { p }) : P.basis.high52;
    case "fairValue":
      return P.basis.fairValue;
  }
}

function LevelChoice({ title, label, value, options, describe, onChange }: { title: string; label: string; value: number | null; options: LevelOption[]; describe: (o: LevelOption) => string; onChange: (v: number | null) => void }) {
  const { t, lang } = useI18n();
  const P = t.plan;
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h4 id={id} className="mb-2 text-sm font-medium">
        {title}
      </h4>
      {options.length > 0 && (
        <ul className="mb-2 grid gap-2 sm:grid-cols-3" aria-label={P.suggestions}>
          {options.map((o) => {
            const on = value !== null && Math.abs(value - o.level) < 0.005;
            return (
              <li key={`${o.basis.kind}-${o.level}`}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(on ? null : o.level)}
                  className={`flex h-full w-full min-h-11 flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors ${on ? "border-fg bg-panel-2" : "border-line hover:bg-panel-2"}`}
                >
                  <span className="num text-sm font-semibold">
                    {fmtPrice(o.level, lang)} <span className="font-normal text-muted">· {fill(P.fromEntry, { p: pctText(o.pct, lang) })}</span>
                  </span>
                  <span className="mt-0.5 text-xs text-muted">{describe(o)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <NumberField label={label} value={value} onChange={onChange} suffix="$" className="w-40" />
    </section>
  );
}

function ReviewPicker({ symbol, value, onChange }: { symbol: string; value: string | null; onChange: (v: string | null) => void }) {
  const { t, lang } = useI18n();
  const P = t.plan;
  const T = t.thesis;
  const id = useId();
  const { state } = useResource<EarningsPayload>(`/api/earnings/${encodeURIComponent(symbol)}`, { shared: true });
  const next = state.status === "ok" && state.data.next.kind !== "unknown" ? state.data.next.date : null;
  const [today] = useState(localToday);
  const options = reviewOptions(today, next);
  return (
    <section aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`} className="mb-2 text-sm font-medium">
        {P.reviewTitle}
      </h4>
      <ul className="mb-2 flex flex-wrap gap-2" aria-label={P.suggestions}>
        {options.map((o) => {
          const on = value === o.date;
          const label = o.kind === "results" ? fill(P.reviewWhen.results, { r: fmtDate(o.results, lang) }) : o.months === 3 ? P.reviewWhen.months3 : P.reviewWhen.months6;
          return (
            <li key={`${o.kind}-${o.date}`}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? null : o.date)}
                className={`flex min-h-11 flex-col items-start rounded-lg border px-3 py-1.5 text-left transition-colors ${on ? "border-fg bg-panel-2" : "border-line hover:bg-panel-2"}`}
              >
                <span className="text-sm">{label}</span>
                <span className="num text-xs text-muted">{fmtDate(o.date, lang)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {state.status === "error" && <p className="mb-2 text-xs text-muted">{P.resultsUnknown}</p>}
      <label htmlFor={id} className="control-label mb-1.5 block">
        {T.reviewBy}
      </label>
      <input id={id} type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="h-11 rounded-lg border border-line bg-panel px-3 text-sm sm:h-9" />
    </section>
  );
}

// ---- Step 3: how much to risk -------------------------------------------------------------------

function SizeStep({ draft }: { draft: Draft }) {
  const { t, lang } = useI18n();
  const P = t.plan;
  const risk = useRisk();
  const fx = useFx(risk.currency);
  const capital = capitalInUsd(risk, fx.state);
  const s = positionSize({ account: capital.usd, pct: risk.pct, entry: draft.entry, stop: draft.stop, target: draft.target, direction: draft.direction, fractions: risk.fractions });
  const pct = (v: number) => `${fmtNum(v * 100, lang, 1)}%`;
  const usd = (v: number) => fmtMoney(v, "USD", lang);
  const word = (n: number) => (n === 1 ? P.shareWord.one : P.shareWord.many);
  let result: React.ReactNode;
  if (draft.stop === null) result = <p>{P.needStop}</p>;
  else if (risk.account === null) result = <p>{P.needAccount}</p>;
  else if (capital.issue) result = <p className="text-warn">{fill(P.fxFailed, { c: risk.currency })}</p>;
  else if (capital.loading) result = <Skeleton className="h-4 w-2/3" />;
  else if (!s) result = <p>{P.needStop}</p>;
  else
    result = (
      <>
        {s.shares === 0 ? (
          <p>{P.zero}</p>
        ) : s.capped ? (
          <p className="font-medium">{fill(P.capped, { n: fmtNum(s.shares, lang, 3), w: word(s.shares), c: usd(s.cost), s: usd(draft.stop), r: usd(s.risk) })}</p>
        ) : (
          <p className="font-medium">{fill(P.shares, { n: fmtNum(s.shares, lang, 3), w: word(s.shares), c: usd(s.cost), s: usd(draft.stop), r: usd(s.risk), p: pct(risk.pct) })}</p>
        )}
        {s.shares > 0 && s.reward !== null && s.ratio !== null && draft.target !== null && <p>{fill(P.reward, { t: usd(draft.target), v: usd(s.reward), r: fmtNum(s.ratio, lang, 1) })}</p>}
        {s.shares > 0 && <p className={s.weight > 0.25 ? "text-warn" : "text-muted"}>{s.weight > 0.25 ? P.concentrated : fill(P.weight, { x: pct(s.weight) })}</p>}
      </>
    );
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">{P.sizeIntro}</p>
      <div className="flex flex-wrap items-end gap-4">
        <NumberField label={fill(P.accountIn, { c: risk.currency })} value={risk.account} onChange={(v) => riskStore.write({ ...risk, account: v !== null && v > 0 ? v : null })} className="w-52" />
        <MoneySettings />
        <div>
          <p className="control-label mb-1.5">{P.riskPct}</p>
          <Segmented label={P.riskPct} value={String(risk.pct)} onChange={(v) => riskStore.write({ ...risk, pct: Number(v) })} options={RISK_PCTS.map((p) => ({ value: String(p), label: pct(p), title: fill(P.pctOf, { p: pct(p) }) }))} />
        </div>
      </div>
      {capital.rate && capital.usd !== null && (
        <p className="num -mt-3 text-xs text-muted">{fill(P.converted, { v: usd(capital.usd), r: fmtNum(capital.rate.perUsd, lang, 2), c: risk.currency, src: t.portfolio.fxSource[capital.rate.source], t: fmtAsOf(capital.rate.asOf, lang) })}</p>
      )}
      <p className="-mt-3 text-xs text-muted">{P.accountHint}</p>
      <div data-testid="sizing" aria-live="polite" className="space-y-1.5 rounded-lg bg-panel-2 p-4 text-sm">
        {result}
      </div>
      <p className="text-xs text-muted">{P.sizeNote}</p>
    </div>
  );
}

// ---- Review -------------------------------------------------------------------------------------

function Summary({ draft }: { draft: Draft }) {
  const { t, lang } = useI18n();
  const P = t.plan;
  const R = t.research;
  const T = t.thesis;
  const money = (v: number | null) => (v === null ? "—" : fmtPrice(v, lang));
  const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
  const list = (s: string) =>
    lines(s).length ? (
      <ul className="list-disc space-y-0.5 pl-4">
        {lines(s).map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    ) : (
      "—"
    );
  const rows: [string, React.ReactNode, boolean?][] = [
    [R.thesis, draft.thesis.trim() || <span className="text-muted">{P.noThesis}</span>, true],
    [R.bull, list(draft.bull), true],
    [R.bear, list(draft.bear), true],
    [P.expect, T.directions[draft.direction]],
    [R.entry, money(draft.entry)],
    [R.stop, money(draft.stop)],
    [R.target, money(draft.target)],
    [R.fairValue, money(draft.fairValue)],
    [T.reviewBy, draft.reviewBy ? fmtDate(draft.reviewBy, lang) : "—"],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2" data-testid="plan-summary">
      {rows.map(([k, v, wide]) => (
        <div key={k} className={wide ? "sm:col-span-2" : ""}>
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="num mt-0.5 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function TextField({ label, hint, value, onChange, rows }: { label: string; hint?: string; value: string; onChange: (v: string) => void; rows: number }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mb-1.5 text-xs text-muted">
          {hint}
        </p>
      )}
      <textarea
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={4000}
        className={`w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm leading-relaxed placeholder:text-muted focus:border-line-strong ${hint ? "" : "mt-1.5"}`}
      />
    </div>
  );
}
