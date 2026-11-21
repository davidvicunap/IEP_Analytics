"use client";

import Link from "next/link";
import { fill, useI18n } from "@/lib/i18n";
import { STEPS, stepsDone, useOnboarding, type StepKey } from "@/lib/onboarding";
import { useNotes } from "@/lib/researchClient";
import { isWatched } from "@/lib/thesis";
import { useHydrated, useWatchlist } from "@/lib/watchlist";
import { openPalette } from "./ExploreMenu";
import { CheckIcon } from "./icons";
import { Panel, buttonClass } from "./ui";

/**
 * Four steps that show what the app is for, each with the button that does it. Steps tick
 * themselves off from what you do; the list can be hidden at any time and goes quiet once done.
 */
export default function GettingStarted() {
  const { t } = useI18n();
  const S = t.start;
  const hydrated = useHydrated();
  const onboarding = useOnboarding();
  const watch = useWatchlist();
  const notes = useNotes();
  if (!hydrated || onboarding.hidden) return null;
  const theses = notes.state.status === "ok" ? notes.state.data.filter((n) => isWatched(n) || n.closed).length : 0;
  const done = stepsDone(onboarding, watch.list.length, theses);
  const count = STEPS.filter((s) => done[s]).length;
  const first = watch.list[0];
  const href: Record<Exclude<StepKey, "palette">, string> = {
    follow: "/screener",
    thesis: first ? `/stock/${encodeURIComponent(first)}?tab=research` : "/research",
    compare: `/compare?s=${(watch.list.length >= 2 ? watch.list.slice(0, 2) : ["AAPL", "MSFT"]).map(encodeURIComponent).join(",")}`,
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
                {!ok &&
                  (k === "palette" ? (
                    <button type="button" onClick={openPalette} className={buttonClass("secondary", true, "mt-2")}>
                      {step.action}
                    </button>
                  ) : (
                    <Link href={href[k]} prefetch={false} className={buttonClass("secondary", true, "mt-2")}>
                      {step.action}
                    </Link>
                  ))}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
