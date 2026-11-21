"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtBig, fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import { buildBrief, partOfDay, type Brief } from "@/lib/brief";
import { daysUntil } from "@/lib/earnings";
import { filingDocUrl, formGroup } from "@/lib/filingsShared";
import { dismissAlert, useNotes, useTheses } from "@/lib/researchClient";
import { byUrgency, isWatched } from "@/lib/thesis";
import { alertText } from "./research/Thesis";
import { useSnapshots, type SnapState } from "@/lib/snapshotClient";
import { useQuotes } from "@/lib/useQuotes";
import { CheckIcon, ChevronRightIcon, FileTextIcon } from "./icons";
import { IssueNote, Panel, Skeleton, StatusMessage } from "./ui";

type Lang = "es" | "en";
const MAX_CHECKED = 40; // SEC summaries asked for at most (3 at a time; cached for half an hour)
const pct = (v: number, lang: Lang) => `${fmtNum(Math.abs(v) * 100, lang, 1)}%`;

/** Today's date in the reader's clock, and the part of the day for the greeting (set after mount). */
function useToday() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  return now;
}

/**
 * The home page for someone who follows stocks: what changed since yesterday, in four short
 * lists, each linking to the place with the detail. Every list says plainly when it's empty.
 */
export default function Briefing({ list, search }: { list: string[]; search?: React.ReactNode }) {
  const { t, lang } = useI18n();
  const B = t.home.brief;
  const now = useToday();
  const checked = list.slice(0, MAX_CHECKED);
  const snaps = useSnapshots(checked);
  const notes = useNotes();
  const fair = useMemo(() => {
    const m = new Map<string, number>();
    if (notes.state.status === "ok") for (const n of notes.state.data) if (n.fairValue !== null) m.set(n.symbol, n.fairValue);
    return m;
  }, [notes.state]);
  const quotes = useQuotes([...fair.keys()]);
  const today = now ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}` : null;

  const brief: Brief | null = useMemo(() => {
    if (!today) return null;
    const symbols = [...new Set([...checked, ...fair.keys()])];
    const price = new Map(quotes.items.map((q) => [q.symbol, q.quote?.price ?? null]));
    return buildBrief(
      symbols.map((s) => {
        const st = snaps.state[s];
        return { symbol: s, snapshot: st?.status === "ok" ? st.data : null, price: price.get(s) ?? null, fairValue: fair.get(s) ?? null };
      }),
      today,
    );
  }, [today, checked.join(","), fair, quotes.items, snaps.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const states = checked.map((s) => snaps.state[s]);
  const formName = (form: string) => t.filings.groups[formGroup(form)];
  const done = states.filter((s) => s && s.status !== "loading").length;
  const loading = done < checked.length;
  const failed = states.filter((s): s is Extract<SnapState, { status: "error" }> => s?.status === "error");
  const quotesLoading = fair.size > 0 && quotes.loading;
  // Lists with nothing in them fold into one line, so what's new comes first.
  const quiet = brief
    ? [
        !loading && !brief.filings.length && B.filings.title,
        !loading && !brief.results.length && B.results.title,
        // Only when the notebooks loaded: if they failed, the theses panel says so instead.
        !quotesLoading && notes.state.status === "ok" && !brief.fairValue.length && B.fairValue.title,
        !loading && !brief.insiders.length && B.insiders.title,
      ].filter((x): x is string => !!x)
    : [];

  return (
    <section aria-labelledby="brief-title" className="space-y-4">
      <div>
        <h1 id="brief-title" className="text-[26px] sm:text-[32px] font-semibold tracking-[-0.02em] leading-tight">
          {now ? B.greeting[partOfDay(now.getHours())] : " "}
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          {now && <span>{sentenceCase(new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { weekday: "long", month: "long", day: "numeric" }).format(now))}</span>}
          {" · "}
          {fill(B.subtitle, { n: list.length })}
        </p>
        {loading && (
          <p role="status" className="mt-1 text-xs text-muted">
            {fill(B.checking, { done, total: checked.length })}
          </p>
        )}
        {search && <div className="mt-4 max-w-xl">{search}</div>}
      </div>

      <Theses />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={B.filings.title} empty={B.filings.empty} loading={loading && !brief?.filings.length} items={brief?.filings ?? []} hideEmpty>
          {(f) => (
            <Row
              key={`${f.symbol}-${f.filing.form}`}
              symbol={f.symbol}
              href={f.filing.form === "10-K" ? `/stock/${encodeURIComponent(f.symbol)}/report?accn=${encodeURIComponent(f.filing.accn)}` : f.count > 1 ? `/stock/${encodeURIComponent(f.symbol)}?tab=filings` : filingDocUrl(f.cik, f.filing)}
              external={f.filing.form !== "10-K" && f.count === 1}
            >
              <span className="font-medium">{formName(f.filing.form)}</span>
              {!formName(f.filing.form).includes(f.filing.form) && <span className="text-muted"> · {f.filing.form}</span>}
              <span className="block text-xs text-muted">
                {f.count > 1 ? fill(B.filings.many, { n: f.count, d: fmtDate(f.filing.filed, lang) }) : fmtDate(f.filing.filed, lang)}
              </span>
              {f.filing.items.length > 0 && (
                <span className="block truncate text-xs text-muted">{f.filing.items.filter((i) => i !== "9.01").map((i) => t.filings.items[i] ?? i).join(" · ")}</span>
              )}
              {f.filing.form === "10-K" && (
                <span className="mt-0.5 flex w-fit items-center gap-1 text-xs">
                  <FileTextIcon size={12} />
                  {B.filings.read}
                </span>
              )}
            </Row>
          )}
        </Section>

        <Section
          title={B.results.title}
          empty={B.results.empty}
          loading={loading && !brief?.results.length}
          hideEmpty
          items={brief?.results ?? []}
          note={brief?.results.length ? B.results.note : undefined}
          more={
            <Link href="/calendar" prefetch={false} className="link text-xs">
              {t.calendar.open}
            </Link>
          }
        >
          {(r) => (
            <Row key={r.symbol} symbol={r.symbol} href={`/stock/${encodeURIComponent(r.symbol)}`}>
              {fill(B.results.around, { d: fmtDate(r.date, lang) })}
              {today && <span className="text-muted"> · {fill(B.results.inDays, { n: Math.max(0, daysUntil(r.date, today)) })}</span>}
            </Row>
          )}
        </Section>

        <Section title={B.fairValue.title} empty={B.fairValue.empty} loading={quotesLoading || notes.state.status === "loading"} items={brief?.fairValue ?? []} hideEmpty>
          {(f) => (
            <Row key={f.symbol} symbol={f.symbol} href={`/stock/${encodeURIComponent(f.symbol)}?tab=research`}>
              {fill(f.gap > 0 ? B.fairValue.below : B.fairValue.above, { p: pct(f.price / f.fairValue - 1, lang), v: fmtPrice(f.fairValue, lang) })}
              <span className="block text-xs text-muted num">{fmtPrice(f.price, lang)}</span>
            </Row>
          )}
        </Section>

        <Section title={B.insiders.title} empty={B.insiders.empty} loading={loading && !brief?.insiders.length} items={brief?.insiders ?? []} hideEmpty>
          {(i) => (
            <Row key={i.symbol} symbol={i.symbol} href={`/stock/${encodeURIComponent(i.symbol)}?tab=filings&view=insiders`}>
              <span className="num">{fill(B.insiders.row, { b: `$${fmtBig(i.bought)}`, s: `$${fmtBig(i.sold)}` })}</span>
              {i.partial && <span className="ml-1.5 text-xs text-warn">{B.insiders.partial}</span>}
            </Row>
          )}
        </Section>
      </div>

      {quiet.length > 0 && (
        <p className="text-sm text-muted" data-testid="brief-quiet">
          {fill(B.quiet, { list: quiet.map((q) => q.charAt(0).toLowerCase() + q.slice(1)).join(" · ") })}{" "}
          {/* The calendar link sits here only when the results list is folded (otherwise it's under the list). */}
          {quiet.includes(B.results.title) && (
            <Link href="/calendar" prefetch={false} className="link">
              {t.calendar.open}
            </Link>
          )}
          {fair.size === 0 && notes.state.status === "ok" && <span className="mt-1 block text-xs">{B.fairValueTip}</span>}
        </p>
      )}
      {failed.length > 0 && (
        <StatusMessage tone="warn">
          {fill(B.issues, { n: failed.length, t: checked.length, why: [...new Set(failed.map((f) => (t.data.issuesShort[f.issue as keyof typeof t.data.issuesShort] ?? f.issue).toLowerCase()))].join(", ") })}
        </StatusMessage>
      )}
      <p className="text-xs text-muted">{B.source}</p>
    </section>
  );
}

/** "Monday, November 23": only the first letter in capitals (Spanish keeps "de noviembre" lower case). */
export const sentenceCase = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

const THESIS_ROWS = 6;

/** Live theses with an active alert, most urgent first; quiet when every thesis is on track. */
function Theses() {
  const { t, lang } = useI18n();
  const T = t.thesis;
  const notes = useNotes();
  const watched = notes.state.status === "ok" ? notes.state.data.filter(isWatched).length : 0;
  const { state, retry } = useTheses();
  // Notebooks that failed to load: say so (their alerts and fair values are missing), don't hide it.
  if (notes.state.status === "error")
    return (
      <Panel title={T.briefTitle} id="theses">
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
    <Panel title={T.briefTitle} id="theses">
      {state.status === "error" ? (
        <IssueNote issue={state.issue} onRetry={retry} />
      ) : !data ? (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{fill(T.briefEmpty, { n: data.items.length })}</p>
      ) : (
        <ul className="-mx-2 -my-1">
          {rows.slice(0, THESIS_ROWS).map((a) => (
            <AlertRow key={`${a.symbol}-${a.key}`} symbol={a.symbol} alertKey={a.key} text={alertText(a, T, lang)} tone={a.tone} />
          ))}
        </ul>
      )}
      {rows.length > THESIS_ROWS && (
        <p className="mt-3 text-xs">
          <Link href="/research" prefetch={false} className="link">
            {fill(T.briefMore, { n: rows.length - THESIS_ROWS })}
          </Link>
        </p>
      )}
      {seen > 0 && (
        <p className="mt-3 text-xs text-muted">
          <Link href="/research" prefetch={false} className="link">
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

function Section<T>({ title, empty, loading, items, note, more, hideEmpty, children }: { title: string; empty: string; loading: boolean; items: T[]; note?: string; more?: React.ReactNode; hideEmpty?: boolean; children: (item: T) => React.ReactNode }) {
  if (hideEmpty && !loading && items.length === 0) return null;
  return (
    <Panel title={title} className="min-w-0">
      {items.length > 0 ? (
        <ul className="-mx-2 -my-1">{items.map(children)}</ul>
      ) : loading ? (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}
      {note && <p className="mt-3 text-xs text-muted">{note}</p>}
      {more && <p className="mt-2">{more}</p>}
    </Panel>
  );
}

function Row({ symbol, href, external, children }: { symbol: string; href: string; external?: boolean; children: React.ReactNode }) {
  const body = (
    <>
      <span className="w-16 shrink-0 font-semibold">{symbol}</span>
      <span className="min-w-0 flex-1 text-sm">{children}</span>
      <ChevronRightIcon size={16} className="mt-0.5 shrink-0 text-muted" />
    </>
  );
  const cls = "flex min-h-11 items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-panel-2";
  return (
    <li>
      {external ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
          {body}
        </a>
      ) : (
        <Link href={href} prefetch={false} className={cls}>
          {body}
        </Link>
      )}
    </li>
  );
}
