"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import { KINDS, RANGES, buildCalendar, byWeek, toIcs, type CalEvent, type EventKind } from "@/lib/calendar";
import { useNotes } from "@/lib/researchClient";
import { useSnapshots, type SnapState } from "@/lib/snapshotClient";
import { useHydrated, useWatchlist } from "@/lib/watchlist";
import { sentenceCase } from "./Briefing";
import { CalendarIcon, DownloadIcon } from "./icons";
import { EmptyState, Panel, Segmented, Skeleton, StatusMessage, ToggleChip, buttonClass } from "./ui";

const MAX_CHECKED = 40;
const DOT: Record<EventKind, string> = { results: "bg-info", deadline: "bg-warn", review: "bg-line-strong" };

/** Today in the reader's clock (set after mount, so the server and the browser agree). */
function useToday() {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const d = new Date();
    setToday(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }, []);
  return today;
}

/** The dates that matter for the stocks you follow and your theses, by week. */
export default function CalendarView() {
  const { t, lang } = useI18n();
  const C = t.calendar;
  const hydrated = useHydrated();
  const watch = useWatchlist();
  const notes = useNotes();
  const today = useToday();
  const [days, setDays] = useState<(typeof RANGES)[number]>(60);
  const [shown, setShown] = useState<Set<EventKind>>(new Set(KINDS));

  const reviews = useMemo(() => {
    const m = new Map<string, string>();
    if (notes.state.status === "ok") for (const n of notes.state.data) if (n.reviewBy && !n.closed) m.set(n.symbol, n.reviewBy);
    return m;
  }, [notes.state]);
  const symbols = [...new Set([...watch.list, ...reviews.keys()])].slice(0, MAX_CHECKED);
  const snaps = useSnapshots(symbols, hydrated);
  const states = symbols.map((s) => snaps.state[s]);
  const done = states.filter((s) => s && s.status !== "loading").length;
  const loading = !hydrated || done < symbols.length;
  const failed = states.filter((s): s is Extract<SnapState, { status: "error" }> => s?.status === "error");

  const events = useMemo(() => {
    if (!today) return [];
    const rows = symbols.map((s) => {
      const st = snaps.state[s];
      return { symbol: s, snapshot: st?.status === "ok" ? st.data : null, reviewBy: reviews.get(s) ?? null };
    });
    return buildCalendar(rows, today, days).filter((e) => shown.has(e.kind));
  }, [today, symbols.join(","), snaps.state, reviews, days, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = (e: CalEvent) => (e.kind === "results" ? C.results : e.kind === "deadline" ? fill(C.deadline, { f: e.form ?? "" }) : C.review);
  const note = (e: CalEvent) =>
    e.kind === "results" && e.basedOn ? fill(C.resultsNote, { d: fmtDate(e.basedOn, lang) }) : e.kind === "deadline" && e.periodEnd ? fill(C.deadlineNote, { d: fmtDate(e.periodEnd, lang) }) : null;
  const dayName = (d: string) =>
    d === today ? C.today : today && d === addDay(today) ? C.tomorrow : sentenceCase(new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)));

  const download = () => {
    const ics = toIcs(events, (e) => fill(C.ics[e.kind], { s: e.symbol, f: e.form ?? "" }));
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "iep-calendar.ics" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{C.title}</h1>
        <p className="mt-1 text-[15px] text-muted">{C.intro}</p>
      </div>

      <section aria-label={C.show} className="flex flex-wrap items-end gap-4 rounded-2xl border border-line bg-panel p-4 sm:p-5">
        <div>
          <p className="control-label mb-1.5">{C.range}</p>
          <Segmented label={C.range} value={String(days)} onChange={(v) => setDays(Number(v) as (typeof RANGES)[number])} options={RANGES.map((n) => ({ value: String(n), label: fill(C.rangeOpt, { n }) }))} />
        </div>
        <div>
          <p className="control-label mb-1.5">{C.show}</p>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <ToggleChip
                key={k}
                on={shown.has(k)}
                onClick={() =>
                  setShown((prev) => {
                    const next = new Set(prev);
                    if (next.has(k)) next.delete(k);
                    else next.add(k);
                    return next;
                  })
                }
              >
                {C.kinds[k]}
              </ToggleChip>
            ))}
          </div>
        </div>
        <button type="button" onClick={download} disabled={events.length === 0} className={buttonClass("secondary", true, "ml-auto")}>
          <DownloadIcon size={15} />
          {C.download}
        </button>
      </section>

      {hydrated && symbols.length === 0 && notes.state.status !== "loading" ? (
        <Panel>
          <EmptyState title={C.title}>{C.none}</EmptyState>
        </Panel>
      ) : loading && events.length === 0 ? (
        <Panel>
          <p role="status" className="mb-3 text-xs text-muted">
            {fill(C.checking, { done, total: symbols.length })}
          </p>
          <Skeleton className="h-40 w-full rounded-lg" />
        </Panel>
      ) : events.length === 0 ? (
        <Panel>
          <p className="flex items-center gap-2 text-sm text-muted">
            <CalendarIcon size={16} />
            {fill(C.empty, { n: days })}
          </p>
        </Panel>
      ) : (
        <div className="space-y-4">
          {loading && (
            <p role="status" className="text-xs text-muted">
              {fill(C.checking, { done, total: symbols.length })}
            </p>
          )}
          {byWeek(events).map((w) => (
            <Panel key={w.monday} title={fill(C.week, { d: fmtDate(w.monday, lang) })}>
              <ul className="-mx-2 -my-1">
                {w.events.map((e) => (
                  <li key={`${e.kind}-${e.symbol}-${e.date}`}>
                    <Link
                      href={`/stock/${encodeURIComponent(e.symbol)}${e.kind === "review" ? "?tab=research" : e.kind === "deadline" ? "?tab=filings" : ""}`}
                      prefetch={false}
                      className="flex min-h-11 items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-panel-2"
                    >
                      <span className="w-28 shrink-0 whitespace-nowrap text-sm text-muted num">{dayName(e.date)}</span>
                      <span className="w-16 shrink-0 font-semibold">{e.symbol}</span>
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="flex items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[e.kind]}`} aria-hidden="true" />
                          {label(e)}
                        </span>
                        {note(e) && <span className="block text-xs text-muted">{note(e)}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}

      {failed.length > 0 && <StatusMessage tone="warn">{fill(C.issues, { n: failed.length, t: symbols.length })}</StatusMessage>}
      <p className="text-xs text-muted">{C.method}</p>
    </div>
  );
}

const addDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
