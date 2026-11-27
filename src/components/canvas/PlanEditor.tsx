"use client";
// The plan window's edit mode: the thesis and its levels, written next to the chart and saved in
// the company's notebook (the same one the stock page, the hub and the alerts read). Only these
// fields are sent, so conditions and alerts set on the stock page stay as they are. Loads only
// when someone edits.
import Link from "next/link";
import { useId, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { LIMITS, rebaseForm, type ResearchNote } from "@/lib/research";
import { saveNote, type SaveIssue } from "@/lib/researchClient";
import { PlanPreview } from "../research/Thesis";
import { StatusMessage, buttonClass } from "../ui";
import { NumberField } from "../valuation/fields";

type Plan = Pick<ResearchNote, "thesis" | "fairValue" | "entry" | "stop" | "target">;
const planOf = (n: ResearchNote): Plan => ({ thesis: n.thesis, fairValue: n.fairValue, entry: n.entry, stop: n.stop, target: n.target });
const same = (a: Plan, b: Plan) => JSON.stringify(a) === JSON.stringify(b);

export default function PlanEditor({
  symbol,
  note,
  price,
  onDone,
  onReload,
  first,
}: {
  symbol: string;
  note: ResearchNote;
  price: number | null;
  /** Back to the plan as saved (after saving, or cancelling). */
  onDone: () => void;
  onReload: () => void;
  /** Nothing written yet: no "Cancel", and a way to the guided plan instead. */
  first: boolean;
}) {
  const { t } = useI18n();
  const R = t.research;
  const C = t.canvas;
  const id = useId();
  const saved = planOf(note);
  const [form, setForm] = useState(saved);
  const [base, setBase] = useState(saved);
  const [seen, setSeen] = useState(note.updatedAt);
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "error"; issue: SaveIssue }>({ kind: "idle" });
  // A newer saved version (another window, tab or device): fields you haven't touched take it,
  // yours stay, and the next save starts from it.
  if (seen !== note.updatedAt) {
    setSeen(note.updatedAt);
    setForm(rebaseForm(form, base, saved));
    setBase(saved);
  }
  const dirty = !same(form, base);
  const set = <K extends keyof Plan>(k: K) => (v: Plan[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!dirty || status.kind === "saving") return;
    setStatus({ kind: "saving" });
    const r = await saveNote(symbol, { ...form, fairValueSource: "manual", price, baseUpdatedAt: note.updatedAt });
    if (!r.ok) return setStatus({ kind: "error", issue: r.error });
    setStatus({ kind: "idle" });
    onDone();
  };

  return (
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
      {first && <p className="text-sm text-muted">{fill(C.planNone, { s: symbol })}</p>}
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {R.thesis}
        </label>
        <textarea
          id={id}
          value={form.thesis}
          onChange={(e) => set("thesis")(e.target.value)}
          rows={3}
          maxLength={LIMITS.text}
          placeholder={R.thesisHint}
          className="mt-1.5 block w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm leading-relaxed placeholder:text-muted"
        />
      </div>
      <div className="@container">
        <div className="grid grid-cols-2 gap-3 @md:grid-cols-4">
          <NumberField label={R.fairValue} value={form.fairValue} onChange={set("fairValue")} suffix="$" />
          <NumberField label={R.entry} value={form.entry} onChange={set("entry")} suffix="$" />
          <NumberField label={R.stop} value={form.stop} onChange={set("stop")} suffix="$" />
          <NumberField label={R.target} value={form.target} onChange={set("target")} suffix="$" />
        </div>
      </div>
      {/* What each level would do from today's price, and a warning when one is already hit. */}
      <PlanPreview plan={{ direction: note.direction, fairValue: form.fairValue, stop: form.stop, target: form.target }} price={price} />
      <div className="flex flex-wrap items-center gap-2">
        {/* Secondary: on a canvas the accent stays on the toolbar's one main action. */}
        <button type="submit" disabled={!dirty || status.kind === "saving"} className={buttonClass("secondary", true)} aria-keyshortcuts="Control+S Meta+S">
          {status.kind === "saving" ? R.saving : R.save}
        </button>
        {!first && (
          <button type="button" onClick={onDone} className={buttonClass("ghost", true)}>
            {C.planCancel}
          </button>
        )}
        <span className="text-xs text-muted" role="status">
          {status.kind === "error" ? null : dirty ? R.unsaved : null}
        </span>
      </div>
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
      {first && (
        <Link href={`/stock/${encodeURIComponent(symbol)}?tab=research&plan=1`} prefetch={false} className="link inline-flex min-h-11 items-center text-sm sm:min-h-0">
          {C.planGuided}
        </Link>
      )}
    </form>
  );
}
