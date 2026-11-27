"use client";
// The canvas windows that hold your own work: the plan and the notes. Both read and write the
// company's notebook, so what you write beside the chart is on its page, in the hub and in the
// alerts, and what you wrote there shows here.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { saveNote, useNote, useTheses } from "@/lib/researchClient";
import { useQuotes } from "@/lib/useQuotes";
import DatedNotes from "../research/DatedNotes";
import { Badge, IssueNote, Provenance, Skeleton, StatusMessage, buttonClass, toast } from "../ui";

const Loading = () => (
  <div className="space-y-3" aria-busy="true">
    <Skeleton className="h-5 w-1/3" />
    <Skeleton className="h-24 w-full" />
  </div>
);
const PlanEditor = dynamic(() => import("./PlanEditor"), { loading: Loading });

/** Your plan for this company: read at a glance, edited in place. */
export function PlanWindow({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const C = t.canvas;
  const { state, retry } = useNote(symbol);
  const theses = useTheses();
  const q = useQuotes([symbol]);
  const item = q.items[0];
  const price = item?.quote?.price ?? null;
  const [editing, setEditing] = useState(false);
  if (state.status === "error") return <IssueNote issue={state.issue} onRetry={retry} />;
  const note = state.status === "ok" ? state.data : state.previous?.data;
  if (!note) return <Loading />;

  const empty = !note.thesis.trim() && note.fairValue === null && note.entry === null && note.stop === null && note.target === null;
  // Nothing written yet: the form is the window.
  if (editing || empty) {
    return <PlanEditor symbol={symbol} note={note} price={price} first={empty && !editing} onDone={() => setEditing(false)} onReload={retry} />;
  }

  const status = theses.state.status === "ok" ? (theses.state.data.items.find((i) => i.symbol === symbol)?.status ?? null) : null;
  const tone = status === "atRisk" ? "bad" : status === "review" ? "warn" : status === "onTrack" ? "good" : "neutral";
  const levels: [string, number | null][] = [
    [C.planFair, note.fairValue],
    [C.planEntry, note.entry],
    [C.planStop, note.stop],
    [C.planTarget, note.target],
  ];
  const gap = (v: number) => (price ? `${v >= price ? "+" : "−"}${fmtNum((Math.abs(v - price) / price) * 100, lang, 1)}%` : null);
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          {status && <Badge tone={tone}>{t.thesis.status[status]}</Badge>}
          {note.thesis.trim() && <p className="max-w-[68ch] text-[15px] leading-relaxed">{note.thesis}</p>}
        </div>
        <button type="button" onClick={() => setEditing(true)} className={buttonClass("secondary", true, "shrink-0")}>
          {C.planEditHere}
        </button>
      </div>
      <dl className="num grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {levels.map(([label, v]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="font-medium">
              {v === null ? "—" : fmtPrice(v, lang)}
              {v !== null && gap(v) && <span className="ml-1.5 text-xs font-normal text-muted">{fill(C.planDistance, { p: gap(v)! })}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {note.reviewBy && (
        <p className="num text-xs text-muted">
          {C.planReview} {fmtDate(note.reviewBy, lang)}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/stock/${encodeURIComponent(symbol)}?tab=research`} prefetch={false} className="link inline-flex min-h-11 items-center text-sm sm:min-h-0">
          {C.planEdit}
        </Link>
        {q.source && item?.quote && <Provenance source={q.source} asOf={item.fetchedAt ?? undefined} stale={item.stale} />}
      </div>
    </div>
  );
}

/**
 * Your dated notes on this company, from its notebook. Text typed in a note window before notes
 * belonged to a company shows on top as a draft, to save into the notebook or discard.
 */
export function NotesWindow({ symbol, draft, onDraft }: { symbol: string | null; draft: string; onDraft: (text: string) => void }) {
  const { t } = useI18n();
  const C = t.canvas;
  return (
    <div className="space-y-4">
      {draft && <Draft symbol={symbol} text={draft} onDraft={onDraft} />}
      {symbol ? <CompanyNotes symbol={symbol} /> : <p className="text-sm text-muted">{C.noteNoCompany}</p>}
    </div>
  );
}

function CompanyNotes({ symbol }: { symbol: string }) {
  const { t } = useI18n();
  const { state, retry } = useNote(symbol);
  if (state.status === "error") return <IssueNote issue={state.issue} onRetry={retry} />;
  const note = state.status === "ok" ? state.data : state.previous?.data;
  if (!note) return <Loading />;
  return (
    <div className="space-y-3">
      <DatedNotes symbol={symbol} note={note} />
      <Link href={`/stock/${encodeURIComponent(symbol)}?tab=research`} prefetch={false} className="link inline-flex min-h-11 items-center text-sm sm:min-h-0">
        {fill(t.canvas.noteNotebook, { s: symbol })}
      </Link>
    </div>
  );
}

function Draft({ symbol, text, onDraft }: { symbol: string | null; text: string; onDraft: (text: string) => void }) {
  const { t } = useI18n();
  const C = t.canvas;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const keep = async () => {
    if (!symbol) return;
    setBusy(true);
    setFailed(false);
    // Adding a note never conflicts with other edits, so no base version is needed.
    const r = await saveNote(symbol, { addNote: text, baseUpdatedAt: null });
    setBusy(false);
    if (r.ok) onDraft("");
    else setFailed(true);
  };
  const discard = () => {
    onDraft("");
    toast({ message: C.draftDiscarded, action: { label: C.undo, run: () => onDraft(text) } });
  };
  return (
    <div className="rounded-lg bg-panel-2 p-3" data-testid="note-draft">
      <p className="text-xs text-muted">{C.draftTitle}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {symbol && (
          <button type="button" disabled={busy} onClick={keep} className={buttonClass("secondary", true)}>
            {busy ? t.research.saving : fill(C.draftSave, { s: symbol })}
          </button>
        )}
        <button type="button" disabled={busy} onClick={discard} className={buttonClass("ghost", true)}>
          {C.draftDiscard}
        </button>
      </div>
      {failed && (
        <StatusMessage tone="warn" className="mt-2">
          {t.research.saveFailed}
        </StatusMessage>
      )}
    </div>
  );
}
