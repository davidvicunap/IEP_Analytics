"use client";

import Link from "next/link";
import { fill, useI18n } from "@/lib/i18n";
import { STEPS, stepsDone, useOnboarding, type StepKey } from "@/lib/onboarding";
import { useNotes } from "@/lib/researchClient";
import { isWatched } from "@/lib/thesis";
import { useTrades } from "@/lib/tradesClient";
import { book, positions } from "@/lib/trades";
import { useHydrated, useWatchlist } from "@/lib/watchlist";
import { CheckIcon } from "./icons";
import { Panel, buttonClass } from "./ui";

/**
 * The four steps of the path the app is built on (own → exit → alerts → follow), each with the
 * button that does it. Steps tick themselves off from what you do; the list can be hidden.
 */
export default function GettingStarted() {
  const { t } = useI18n();
  const S = t.start;
  const hydrated = useHydrated();
  const onboarding = useOnboarding();
  const watch = useWatchlist();
  const notes = useNotes();
  const trades = useTrades();
  if (!hydrated || onboarding.hidden) return null;
  const theses = notes.state.status === "ok" ? notes.state.data.filter((n) => isWatched(n) || n.closed).length : 0;
  const held = trades.state.status === "ok" ? positions(book(trades.state.data).open).map((p) => p.symbol) : [];
  const done = stepsDone(onboarding, { positions: held.length, theses, following: watch.list.length });
  const count = STEPS.filter((s) => done[s]).length;
  const first = held[0] ?? watch.list[0];
  const href: Record<StepKey, string> = {
    position: "#portfolio",
    exit: first ? `/stock/${encodeURIComponent(first)}?tab=research&plan=1` : "/research",
    alerts: "/research#push",
    follow: "/screener",
  };

  if (count === STEPS.length) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel px-5 py-3 text-sm" id="getting-started">
        <CheckIcon size={16} className="text-up" />
        <span className="flex-1">{S.done}</span>
        <button type="button" onClick={onboarding.hide} className={buttonClass("ghost", true, "text-muted")}>
          {S.hide}
        </button>
      </div>
    );
  }

  return (
    <Panel
      title={S.title}
      description={fill(S.progress, { n: count, t: STEPS.length })}
      id="getting-started"
      action={
        <button type="button" onClick={onboarding.hide} className={buttonClass("ghost", true, "text-muted")}>
          {S.hide}
        </button>
      }
    >
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-panel-2" aria-hidden="true">
        <div className="h-full rounded-full bg-up transition-[width]" style={{ width: `${(count / STEPS.length) * 100}%` }} />
      </div>
      <ol className="grid gap-3 sm:grid-cols-2">
        {STEPS.map((k, i) => {
          const step = S.steps[k];
          const ok = done[k];
          return (
            <li key={k} className={`flex gap-3 rounded-xl border border-line p-3 ${ok ? "bg-panel-2/60" : ""}`}>
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${ok ? "bg-up text-white" : "border border-line-strong text-muted"}`} aria-hidden="true">
                {ok ? <CheckIcon size={14} /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium ${ok ? "text-muted line-through decoration-1" : ""}`}>
                  {step.title}
                  {ok && <span className="sr-only"> ({S.stepDone})</span>}
                </span>
                {!ok && <span className="mt-0.5 block text-xs text-muted">{step.desc}</span>}
                {!ok && (
                  <Link href={href[k]} prefetch={false} className={buttonClass("secondary", true, "mt-2")}>
                    {step.action}
                  </Link>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
