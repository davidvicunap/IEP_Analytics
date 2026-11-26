"use client";

import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtPrice } from "@/lib/format";
import { upside } from "@/lib/research";
import { useNote, useThesis } from "@/lib/researchClient";
import { isWatched } from "@/lib/thesis";
import { NotebookIcon } from "../icons";
import { Panel, buttonClass } from "../ui";
import { signedPct } from "./ResearchPanel";
import { StatusBadge, alertText } from "./Thesis";

/** Header line: the user's fair value and how far the price is from it. Nothing until they set one. */
export function FairValueLine({ symbol, price, onOpen }: { symbol: string; price: number | null; onOpen: () => void }) {
  const { t, lang } = useI18n();
  const R = t.research;
  const { state } = useNote(symbol);
  const note = state.status === "ok" ? state.data : null;
  if (!note || note.fairValue === null) return null;
  const up = upside(note.fairValue, price);
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-testid="fair-value-line">
      <NotebookIcon size={15} className="text-muted" />
      <span className="font-medium">{fill(R.yourValue, { v: fmtPrice(note.fairValue, lang) })}</span>
      {up !== null && (
        <span className="text-muted">
          · {up >= 0 ? fill(R.above, { p: signedPct(up, lang).replace("+", "") }) : fill(R.below, { p: signedPct(-up, lang).replace("+", "") })}
        </span>
      )}
      <button type="button" onClick={onOpen} className="link text-[13px]">
        {R.open}
      </button>
    </p>
  );
}

/**
 * The stock page's one primary action, in its header: start a thesis, or go back to yours.
 * Until the notebook has loaded it offers to write one (the common case for a new company). On the
 * research tab itself it steps back (`quiet`), so the plan's own button is the one primary action.
 */
export function ThesisButton({ symbol, onOpen, quiet = false, className = "" }: { symbol: string; onOpen: () => void; quiet?: boolean; className?: string }) {
  const { t } = useI18n();
  const R = t.research;
  const { state } = useNote(symbol);
  const started = state.status === "ok" && state.data.updatedAt !== null;
  return (
    <button type="button" onClick={onOpen} className={buttonClass(quiet ? "secondary" : "primary", true, className)} data-testid="thesis-button">
      <NotebookIcon size={16} />
      {started ? R.mine : R.start}
    </button>
  );
}

/** Overview card: your thesis at a glance. Before there is one, the header's button is the way in. */
export function ResearchCard({ symbol, price, onOpen }: { symbol: string; price: number | null; onOpen: () => void }) {
  const { t, lang } = useI18n();
  const R = t.research;
  const { state } = useNote(symbol);
  if (state.status !== "ok") return null; // the notebook is optional: no skeleton, no error box on the overview
  const note = state.data;
  const started = note.updatedAt !== null;
  if (!started) return null;
  const up = upside(note.fairValue, price);
  const lastNote = note.log.find((e) => e.kind === "note");
  return (
    <Panel bare className="border-t border-line pt-5" title={R.title} id="research-card" action={note.closed ? <StatusBadge status="closed" /> : isWatched(note) ? <CardStatus symbol={symbol} /> : undefined}>
      <div className="space-y-2 text-sm">
          {note.thesis ? <p className="line-clamp-4 whitespace-pre-wrap">{note.thesis}</p> : <p className="text-muted">{R.noThesis}</p>}
          {note.fairValue !== null && (
            <p>
              <span className="font-medium">{fill(R.yourValue, { v: fmtPrice(note.fairValue, lang) })}</span>
              {up !== null && <span className="text-muted"> · {signedPct(up, lang)}</span>}
            </p>
          )}
          {isWatched(note) && <CardAlert symbol={symbol} />}
          {lastNote && <p className="text-xs text-muted">{fill(R.lastNote, { d: fmtAsOf(lastNote.at, lang) })}</p>}
          <button type="button" onClick={onOpen} className="link text-[13px]">
            {R.open}
          </button>
      </div>
    </Panel>
  );
}

function CardStatus({ symbol }: { symbol: string }) {
  const { state } = useThesis(symbol);
  return state.status === "ok" ? <StatusBadge status={state.data.status} /> : null;
}

/** The most urgent alert, if any: the full list is in the tab. */
function CardAlert({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const { state } = useThesis(symbol);
  const a = state.status === "ok" ? state.data.alerts.find((x) => !x.dismissedAt) : undefined;
  if (!a) return null;
  return (
    <p className="num">
      {alertText(a, t.thesis, lang)}
      {state.status === "ok" && state.data.alerts.length > 1 && <span className="text-muted"> · +{state.data.alerts.length - 1}</span>}
    </p>
  );
}
