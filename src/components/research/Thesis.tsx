"use client";

import { useId, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import type { CoreDict } from "@/lib/i18n/es";
import { fmtAsOf, fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import type { ResearchNote } from "@/lib/research";
import { saveNote, useThesis, type SaveIssue } from "@/lib/researchClient";
import { CHECK_LIMIT, RESULTS_DAYS, isWatched, thesisReturn, type CheckBody, type CheckType, type Direction, type Outcome, type SignalData, type SignalKind, type StoredAlert, type ThesisStatus } from "@/lib/thesis";
import { VERDICT_KEYS, type VerdictKey } from "@/lib/verdict";
import { AlertIcon, CheckIcon, ClockIcon, CloseIcon, PlusIcon } from "../icons";
import { NumberField } from "../valuation/fields";
import { Badge, IssueNote, Panel, Segmented, Skeleton, StatusMessage, buttonClass } from "../ui";

type Lang = "es" | "en";
type T = CoreDict["thesis"];
export type DraftCheck = CheckBody & { id?: string };

const BADGE: Record<ThesisStatus, "bad" | "warn" | "good" | "neutral"> = { atRisk: "bad", review: "warn", onTrack: "good", closed: "neutral", idle: "neutral" };

/** One word for the thesis, with a mark so it doesn't rely on colour alone. */
export function StatusBadge({ status, className = "" }: { status: ThesisStatus; className?: string }) {
  const { t } = useI18n();
  const Icon = status === "atRisk" || status === "review" ? AlertIcon : status === "onTrack" ? CheckIcon : ClockIcon;
  return (
    <Badge tone={BADGE[status]} className={className}>
      <Icon size={11} aria-hidden="true" />
      {t.thesis.status[status]}
    </Badge>
  );
}

const pctText = (v: number, lang: Lang) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtNum(Math.abs(v), lang, 1)}%`;

/** The alert in one sentence, with the figures that raised it. */
export function alertText(a: { kind: SignalKind; data: SignalData }, T: T, lang: Lang): string {
  const d = a.data;
  const v = d.level !== undefined ? fmtPrice(d.level, lang) : "—";
  const p = d.price !== undefined ? fmtPrice(d.price, lang) : "—";
  switch (a.kind) {
    case "stop":
    case "target":
    case "fairValue":
      return fill(T.alerts[a.kind], { v, p });
    case "reviewBy":
      return fill(T.alerts.reviewBy, { d: d.date ? fmtDate(d.date, lang) : "—" });
    case "price":
      return fill(T.alerts.price[d.op ?? "below"], { v, p });
    case "move":
      return fill(T.alerts.move, { c: d.changePct !== undefined ? pctText(d.changePct, lang) : "—", x: fmtNum(d.pct ?? 0, lang, 2) });
    case "verdict":
      return fill(T.alerts.verdict, { a: d.area ? T.areas[d.area] : "—", n: d.now ? T.levels[d.now] : "—", m: d.min ? T.minsShort[d.min] : "—" });
    case "report":
      return fill(T.alerts.report, { f: d.form ?? "", d: d.filed ? fmtDate(d.filed, lang) : "—" });
    case "results":
      return fill(T.alerts.results, { d: d.date ? fmtDate(d.date, lang) : "—" });
  }
}

/** A condition the user set, in words. */
export function describeCheck(c: DraftCheck, T: T, lang: Lang): string {
  switch (c.type) {
    case "price":
      return fill(T.describe.price[c.op], { v: fmtPrice(c.value, lang) });
    case "move":
      return fill(T.describe.move, { p: fmtNum(c.pct, lang, 2) });
    case "verdict":
      return fill(T.describe.verdict[c.min], { a: T.areas[c.area] });
    case "report":
      return T.describe.report;
    case "results":
      return fill(T.describe.results, { n: c.days });
  }
}

/** The top of "My research": what the thesis says today, its alerts, and closing or reopening it. */
export function ThesisSummary({ symbol, note, price }: { symbol: string; note: ResearchNote; price: number | null }) {
  const { t, lang } = useI18n();
  const T = t.thesis;
  const { state, retry } = useThesis(symbol);
  const [closing, setClosing] = useState(false);
  const [reopenIssue, setReopenIssue] = useState<SaveIssue | null>(null);
  const view = state.status === "ok" ? state.data : state.status === "loading" ? state.previous?.data : undefined;

  if (note.closed) {
    const c = note.closed;
    const r = thesisReturn(note.direction, note.opened?.price, c.price);
    return (
      <Panel title={T.statusTitle} action={<StatusBadge status="closed" />}>
        <p className="text-sm">{fill(T.closed, { d: fmtDate(c.at.slice(0, 10), lang), o: T.outcomes[c.outcome] })}</p>
        {r !== null && note.opened?.price && c.price && (
          <p className="mt-1 text-sm text-muted num">{fill(T.result, { a: fmtPrice(note.opened.price, lang), b: fmtPrice(c.price, lang), r: pctText(r * 100, lang) })}</p>
        )}
        {c.lesson && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-panel-2 px-3 py-2 text-sm">{c.lesson}</p>}
        <button
          type="button"
          className={buttonClass("secondary", true, "mt-4")}
          onClick={async () => {
            setReopenIssue(null);
            const res = await saveNote(symbol, { reopen: true, price, baseUpdatedAt: note.updatedAt });
            if (!res.ok) setReopenIssue(res.error);
          }}
        >
          {T.reopen}
        </button>
        {reopenIssue && <StatusMessage tone="warn" className="mt-2">{t.research.saveFailed}</StatusMessage>}
      </Panel>
    );
  }

  const watched = isWatched(note);
  const status: ThesisStatus = view?.status ?? (watched ? "onTrack" : "idle");
  return (
    <Panel title={T.statusTitle} action={watched && view ? <StatusBadge status={status} /> : undefined} id="thesis-status">
      {!watched ? (
        <p className="text-sm text-muted">{T.statusHint.idle}</p>
      ) : state.status === "error" ? (
        <IssueNote issue={state.issue} onRetry={retry} />
      ) : !view ? (
        <>
          <p role="status" className="sr-only">{t.ux.loading}</p>
          <Skeleton className="h-12 w-full rounded-lg" />
        </>
      ) : (
        <div aria-live="polite">
          <p className="text-sm">{T.statusHint[status]}</p>
          {view.alerts.length > 0 && <AlertList alerts={view.alerts} T={T} lang={lang} />}
          {view.unchecked.length > 0 && (
            <StatusMessage tone="warn" className="mt-3">
              {fill(T.unchecked, { list: [...new Set(view.unchecked.map((k) => T.uncheckedNames[k]))].join(", ") })}
            </StatusMessage>
          )}
          <p className="mt-3 text-xs text-muted">
            {state.status === "ok" && fill(T.checked, { t: fmtAsOf(state.fetchedAt, lang) })}
            {view.priceAt && ` · ${fill(T.priceAt, { t: fmtAsOf(view.priceAt, lang) })}`}
          </p>
        </div>
      )}
      {watched &&
        (closing ? (
          <CloseForm symbol={symbol} note={note} price={price} onDone={() => setClosing(false)} />
        ) : (
          <button type="button" className={buttonClass("ghost", true, "mt-3 -ml-2 text-muted")} onClick={() => setClosing(true)}>
            {T.close}
          </button>
        ))}
    </Panel>
  );
}

function AlertList({ alerts, T, lang }: { alerts: StoredAlert[]; T: T; lang: Lang }) {
  return (
    <ul className="mt-3 space-y-2">
      {alerts.map((a) => (
        <li key={`${a.key}-${a.firedAt}`} className="flex items-start gap-2 text-sm">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.tone === "risk" ? "bg-down" : a.tone === "good" ? "bg-up" : "bg-warn"}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className="sr-only">{T.tones[a.tone]}: </span>
            <span className="num">{alertText(a, T, lang)}</span>
            <span className="text-xs text-muted"> · {fill(T.since, { d: fmtAsOf(a.firedAt, lang) })}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function CloseForm({ symbol, note, price, onDone }: { symbol: string; note: ResearchNote; price: number | null; onDone: () => void }) {
  const { t, lang } = useI18n();
  const T = t.thesis;
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [lesson, setLesson] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const id = useId();
  return (
    <form
      className="mt-4 space-y-3 rounded-xl border border-line p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!outcome) return;
        setBusy(true);
        setFailed(false);
        const r = await saveNote(symbol, { close: { outcome, lesson }, price, baseUpdatedAt: note.updatedAt });
        setBusy(false);
        if (r.ok) onDone();
        else setFailed(true);
      }}
    >
      <p className="text-sm font-medium">{T.close}</p>
      <p className="text-xs text-muted">{fill(T.closeIntro, { p: price === null ? "—" : fmtPrice(price, lang) })}</p>
      <div>
        <p className="control-label mb-1.5">{T.outcome}</p>
        <Segmented label={T.outcome} value={outcome ?? ("" as Outcome)} onChange={setOutcome} options={(["right", "mixed", "wrong"] as const).map((o) => ({ value: o, label: T.outcomes[o] }))} />
      </div>
      <div>
        <label htmlFor={id} className="control-label mb-1.5 block">
          {T.lesson}
        </label>
        <textarea id={id} value={lesson} onChange={(e) => setLesson(e.target.value)} rows={3} maxLength={2000} className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm" />
      </div>
      {failed && <StatusMessage tone="warn">{t.research.saveFailed}</StatusMessage>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!outcome || busy} className={buttonClass("primary", true)}>
          {T.close}
        </button>
        <button type="button" onClick={onDone} className={buttonClass("ghost", true)}>
          {T.cancel}
        </button>
      </div>
    </form>
  );
}

export interface WatchValue {
  direction: Direction;
  reviewBy: string | null;
  checks: DraftCheck[];
}

/** "What to watch": the direction the user expects, a review date and their own conditions. */
export function WatchEditor({ value, onChange }: { value: WatchValue; onChange: (v: WatchValue) => void }) {
  const { t, lang } = useI18n();
  const T = t.thesis;
  const dateId = useId();
  const [adding, setAdding] = useState(false);
  const set = (patch: Partial<WatchValue>) => onChange({ ...value, ...patch });
  return (
    <Panel title={T.watch} description={T.watchIntro}>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className="control-label mb-1.5">{T.direction}</p>
          <Segmented label={T.direction} value={value.direction} onChange={(direction) => set({ direction })} options={(["up", "down"] as const).map((d) => ({ value: d, label: T.directions[d] }))} />
        </div>
        <div>
          <label htmlFor={dateId} className="control-label mb-1.5 block">
            {T.reviewBy}
          </label>
          <input
            id={dateId}
            type="date"
            value={value.reviewBy ?? ""}
            onChange={(e) => set({ reviewBy: e.target.value || null })}
            className="h-11 sm:h-9 rounded-lg border border-line bg-panel px-3 text-sm"
          />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">{T.always}</p>

      {value.checks.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{T.none}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {value.checks.map((c, i) => {
            const text = describeCheck(c, T, lang);
            return (
              <li key={c.id ?? `new-${i}`} className="flex items-center gap-3 py-1.5">
                <span className="flex-1 text-sm">{text}</span>
                <button
                  type="button"
                  onClick={() => set({ checks: value.checks.filter((_, j) => j !== i) })}
                  className="grid h-11 w-11 sm:h-9 sm:w-9 shrink-0 place-items-center rounded-md text-muted hover:bg-panel-2 hover:text-fg"
                  aria-label={fill(T.remove, { c: text })}
                >
                  <CloseIcon size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        <AddCheck
          onAdd={(c) => {
            set({ checks: [...value.checks, c] });
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : value.checks.length >= CHECK_LIMIT ? (
        <p className="mt-3 text-xs text-muted">{fill(T.limit, { n: CHECK_LIMIT })}</p>
      ) : (
        <button type="button" className={buttonClass("secondary", true, "mt-3")} onClick={() => setAdding(true)}>
          <PlusIcon size={15} />
          {T.add}
        </button>
      )}
    </Panel>
  );
}

const SELECT = "h-11 sm:h-9 w-full rounded-lg border border-line bg-panel px-3 text-sm";

/** A small form for one new condition; nothing is saved until the notebook is. */
function AddCheck({ onAdd, onCancel }: { onAdd: (c: DraftCheck) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const T = t.thesis;
  const ids = { type: useId(), op: useId(), area: useId(), min: useId(), days: useId() };
  const [type, setType] = useState<CheckType>("price");
  const [op, setOp] = useState<"below" | "above">("below");
  const [level, setLevel] = useState<number | null>(null);
  const [pct, setPct] = useState<number | null>(5);
  const [area, setArea] = useState<VerdictKey>("growth");
  const [min, setMin] = useState<"good" | "mid">("mid");
  const [days, setDays] = useState<number>(7);

  const draft: DraftCheck | null =
    type === "price"
      ? level !== null && level > 0
        ? { type, op, value: level }
        : null
      : type === "move"
        ? pct !== null && pct > 0 && pct <= 100
          ? { type, pct }
          : null
        : type === "verdict"
          ? { type, area, min }
          : type === "results"
            ? { type, days }
            : { type: "report" };

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-line p-4">
      <div>
        <label htmlFor={ids.type} className="control-label mb-1.5 block">
          {T.type}
        </label>
        <select id={ids.type} value={type} onChange={(e) => setType(e.target.value as CheckType)} className={SELECT}>
          {(["price", "move", "verdict", "report", "results"] as const).map((k) => (
            <option key={k} value={k}>
              {T.types[k]}
            </option>
          ))}
        </select>
      </div>
      {type === "price" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.op} className="control-label mb-1.5 block">
              {T.opLabel}
            </label>
            <select id={ids.op} value={op} onChange={(e) => setOp(e.target.value as "below" | "above")} className={SELECT}>
              <option value="below">{T.ops.below}</option>
              <option value="above">{T.ops.above}</option>
            </select>
          </div>
          <NumberField label={T.level} value={level} onChange={setLevel} suffix="$" />
        </div>
      )}
      {type === "move" && <NumberField label={T.pct} value={pct} onChange={setPct} suffix="%" digits={1} className="max-w-48" />}
      {type === "verdict" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.area} className="control-label mb-1.5 block">
              {T.area}
            </label>
            <select id={ids.area} value={area} onChange={(e) => setArea(e.target.value as VerdictKey)} className={SELECT}>
              {VERDICT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {T.areas[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={ids.min} className="control-label mb-1.5 block">
              {T.min}
            </label>
            <select id={ids.min} value={min} onChange={(e) => setMin(e.target.value as "good" | "mid")} className={SELECT}>
              <option value="good">{T.mins.good}</option>
              <option value="mid">{T.mins.mid}</option>
            </select>
          </div>
        </div>
      )}
      {type === "results" && (
        <div className="max-w-48">
          <label htmlFor={ids.days} className="control-label mb-1.5 block">
            {T.days}
          </label>
          <select id={ids.days} value={days} onChange={(e) => setDays(Number(e.target.value))} className={SELECT}>
            {RESULTS_DAYS.map((n) => (
              <option key={n} value={n}>
                {fill(T.daysOpt, { n })}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!draft} onClick={() => draft && onAdd(draft)} className={buttonClass("secondary", true)}>
          <PlusIcon size={15} />
          {T.add}
        </button>
        <button type="button" onClick={onCancel} className={buttonClass("ghost", true)}>
          {T.cancel}
        </button>
      </div>
    </div>
  );
}

/** What happened to the thesis, newest first: when it started, each alert, closing and reopening. */
export function ThesisHistory({ symbol, note }: { symbol: string; note: ResearchNote }) {
  const { t, lang } = useI18n();
  const T = t.thesis;
  const { state } = useThesis(symbol);
  const history = state.status === "ok" ? state.data.history : state.status === "loading" ? (state.previous?.data.history ?? []) : [];
  type Row = { at: string; text: string; tone?: "risk" | "attention" | "good" | "muted" };
  const rows: Row[] = [];
  for (const e of note.log) {
    if (e.kind !== "status") continue;
    const at = e.price !== null ? ` · ${fill(T.atPrice, { p: fmtPrice(e.price, lang) })}` : "";
    const text = e.to === "closed" ? fill(T.events.closed, { o: e.outcome ? T.outcomes[e.outcome] : "" }) : T.events[e.to];
    rows.push({ at: e.at, text: text + at });
  }
  // Closing a thesis ends its alerts; they didn't stop being true, so that isn't listed.
  const closings = note.log.filter((e) => e.kind === "status" && e.to === "closed").map((e) => e.at);
  const endedByClosing = (a: StoredAlert) => !!a.clearedAt && closings.some((c) => c >= a.firedAt && c <= a.clearedAt!);
  for (const a of history) {
    rows.push({ at: a.firedAt, text: alertText(a, T, lang), tone: a.tone });
    if (a.clearedAt && !endedByClosing(a)) rows.push({ at: a.clearedAt, text: `${T.events.cleared}: ${alertText(a, T, lang)}`, tone: "muted" });
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Panel title={T.history}>
      <ol className="divide-y divide-line border-y border-line">
        {rows.slice(0, 60).map((r, i) => (
          <li key={`${r.at}-${i}`} className="flex items-start gap-3 py-2.5">
            <time dateTime={r.at} className="num w-28 shrink-0 pt-0.5 text-xs text-muted">
              {fmtAsOf(r.at, lang)}
            </time>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.tone === "risk" ? "bg-down" : r.tone === "good" ? "bg-up" : r.tone === "attention" ? "bg-warn" : "bg-line-strong"}`} aria-hidden="true" />
            <p className={`min-w-0 flex-1 text-sm num ${r.tone === "muted" ? "text-muted" : ""}`}>{r.text}</p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
