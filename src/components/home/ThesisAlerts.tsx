"use client";

import Link from "next/link";
import { useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { dismissAlert, useNotes, useTheses } from "@/lib/researchClient";
import { byUrgency, isWatched } from "@/lib/thesis";
import { alertText } from "../research/Thesis";
import { CheckIcon } from "../icons";
import { IssueNote, Panel, Skeleton } from "../ui";

const THESIS_ROWS = 6;

/** Live theses with an active alert, most urgent first; quiet when every thesis is on track. */
export function ThesisAlerts({ title }: { title?: string } = {}) {
  const { t, lang } = useI18n();
  const T = t.thesis;
  const notes = useNotes();
  const watched = notes.state.status === "ok" ? notes.state.data.filter(isWatched).length : 0;
  const { state, retry } = useTheses();
  // Notebooks that failed to load: say so (their alerts and fair values are missing), don't hide it.
  if (notes.state.status === "error")
    return (
      <Panel title={title ?? T.briefTitle} id="theses">
        <IssueNote issue={notes.state.issue} onRetry={notes.retry} />
      </Panel>
    );
  if (watched === 0) return null;
  const data = state.status === "ok" ? state.data : state.status === "loading" ? state.previous?.data : undefined;
  const all = (data?.items ?? []).flatMap((i) => i.alerts.map((a) => ({ ...a, symbol: i.symbol })));
  // Alerts marked as seen leave the home page; they stay on each thesis.
  const rows = all.filter((a) => !a.dismissedAt).sort(byUrgency);
  const seen = all.length - rows.length;
  return (
    <Panel title={title ?? T.briefTitle} id="theses">
      {state.status === "error" ? (
        <IssueNote issue={state.issue} onRetry={retry} />
      ) : !data ? (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{data.items.length === 1 ? T.briefEmptyOne : fill(T.briefEmpty, { n: data.items.length })}</p>
      ) : (
        <ul className="-mx-2 -my-1">
          {rows.slice(0, THESIS_ROWS).map((a) => (
            <AlertRow key={`${a.symbol}-${a.key}`} symbol={a.symbol} alertKey={a.key} text={alertText(a, T, lang)} tone={a.tone} />
          ))}
        </ul>
      )}
      {rows.length > THESIS_ROWS && (
        <p className="mt-3 text-xs">
          <Link href="/" prefetch={false} className="link">
            {fill(T.briefMore, { n: rows.length - THESIS_ROWS })}
          </Link>
        </p>
      )}
      {seen > 0 && (
        <p className="mt-3 text-xs text-muted">
          <Link href="/" prefetch={false} className="link">
            {seen === 1 ? T.briefSeenOne : fill(T.briefSeen, { n: seen })}
          </Link>
        </p>
      )}
      {data && data.skipped > 0 && <p className="mt-3 text-xs text-muted">{fill(T.skipped, { n: data.skipped })}</p>}
    </Panel>
  );
}

/** An alert on the home page: opens the thesis, or is marked as seen in place. */
function AlertRow({ symbol, alertKey, text, tone }: { symbol: string; alertKey: string; text: string; tone: "risk" | "attention" | "good" }) {
  const { t } = useI18n();
  const T = t.thesis;
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  return (
    <li className="flex items-start gap-1">
      <Link href={`/stock/${encodeURIComponent(symbol)}?tab=research`} prefetch={false} className="flex min-h-11 min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-panel-2">
        <span className="w-16 shrink-0 font-semibold">{symbol}</span>
        <span className="flex min-w-0 flex-1 items-start gap-2 text-sm">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone === "risk" ? "bg-down" : tone === "good" ? "bg-up" : "bg-warn"}`} aria-hidden="true" />
          <span className="num">
            <span className="sr-only">{T.tones[tone]}: </span>
            {text}
            {state === "failed" && <span className="block text-xs text-warn">{T.dismissFailed}</span>}
          </span>
        </span>
      </Link>
      <button
        type="button"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          const r = await dismissAlert(symbol, alertKey);
          setState(r.ok ? "idle" : "failed");
        }}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-panel-2 hover:text-fg"
        aria-label={fill(T.dismissLabel, { a: `${symbol}: ${text}` })}
        title={T.dismiss}
      >
        <CheckIcon size={16} />
      </button>
    </li>
  );
}
