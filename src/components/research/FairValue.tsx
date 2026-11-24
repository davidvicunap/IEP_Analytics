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

/** Overview card: the thesis at a glance, or an invitation to write one. */
export function ResearchCard({ symbol, price, onOpen }: { symbol: string; price: number | null; onOpen: () => void }) {
  const { t, lang } = useI18n();
  const R = t.research;
  const { state } = useNote(symbol);
  if (state.status !== "ok") return null; // the notebook is optional: no skeleton, no error box on the overview
  const note = state.data;
  const started = note.updatedAt !== null;
  const up = upside(note.fairValue, price);
  const lastNote = note.log.find((e) => e.kind === "note");
  return (
    <Panel bare className="border-t border-line pt-5" title={R.title} id="research-card" action={note.closed ? <StatusBadge status="closed" /> : isWatched(note) ? <CardStatus symbol={symbol} /> : undefined}>
      {started ? (
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
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">{R.cardEmpty}</p>
          <button type="button" onClick={onOpen} className={buttonClass("secondary", true)}>
            <NotebookIcon size={16} />
            {R.start}
          </button>
        </div>
      )}
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
