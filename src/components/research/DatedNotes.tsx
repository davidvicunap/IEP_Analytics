"use client";

import { useId, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf } from "@/lib/format";
import { LIMITS, type ResearchNote } from "@/lib/research";
import { saveNote, type SaveIssue } from "@/lib/researchClient";
import { TrashIcon } from "../icons";
import { Panel, StatusMessage, buttonClass } from "../ui";

/**
 * A company's dated notes, newest first, with a box to add one. The same notes everywhere: the
 * research tab and any canvas note window for the company read and write the notebook. Adding and
 * deleting only touch their own entry, so they never conflict with an edit made elsewhere.
 * The layout follows the space it has (a canvas window can be narrow on a wide screen).
 */
export default function DatedNotes({ symbol, note }: { symbol: string; note: ResearchNote }) {
  const { t, lang } = useI18n();
  const R = t.research;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<SaveIssue | null>(null);
  const id = useId();
  const notes = note.log.filter((e) => e.kind === "note");
  const run = async (input: { addNote?: string; removeNote?: string }) => {
    setBusy(true);
    setFailed(null);
    const r = await saveNote(symbol, { ...input, baseUpdatedAt: note.updatedAt });
    setBusy(false);
    if (!r.ok) setFailed(r.error);
    else if (input.addNote) setText("");
  };
  const add = () => {
    if (text.trim() && !busy) run({ addNote: text });
  };
  return (
    <Panel title={R.log}>
      <div className="@container">
        <form
          className="flex flex-col gap-2 @md:flex-row @md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="flex-1">
            <label htmlFor={id} className="control-label mb-1.5 block">
              {R.noteLabel}
            </label>
            <textarea
              id={id}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter writes a new line; Ctrl/⌘ + Enter adds the note.
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  add();
                }
              }}
              rows={2}
              maxLength={LIMITS.note}
              placeholder={R.notePlaceholder}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              className="block w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm leading-relaxed placeholder:text-muted"
            />
          </div>
          <button type="submit" disabled={busy || !text.trim()} className={buttonClass("secondary", true, "self-start @md:self-auto")}>
            {busy ? R.saving : R.addNote}
          </button>
        </form>
        {failed && (
          <StatusMessage tone="warn" className="mt-2">
            {failed === "beta_expired" ? t.data.betaExpired : R.saveFailed}
          </StatusMessage>
        )}
        {notes.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{R.noNotes}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {notes.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 py-2.5 @md:flex-row @md:items-start @md:gap-3">
                <time dateTime={e.at} className="num shrink-0 pt-0.5 text-xs text-muted @md:w-28">
                  {fmtAsOf(e.at, lang)}
                </time>
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{e.kind === "note" ? e.text : null}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run({ removeNote: e.id })}
                    className="-my-2.5 grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted hover:bg-panel-2 hover:text-fg sm:-my-1.5 sm:h-9 sm:w-9"
                    aria-label={fill(R.deleteNote, { d: fmtAsOf(e.at, lang) })}
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
