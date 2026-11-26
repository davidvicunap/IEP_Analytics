"use client";

import { useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf } from "@/lib/format";
import type { ExplainPoint, Fact } from "@/lib/explain";
import type { ExplainPayload } from "@/lib/explainData";
import { sharedLoader, toViewResult, type ViewIssue } from "@/lib/resource";
import { useResource } from "@/lib/useResource";
import { ExternalIcon } from "./icons";
import { IssueNote, Panel, Skeleton, StatusMessage, buttonClass } from "./ui";

/**
 * "Explained by AI": the last quarter and the case for and against, each sentence followed by
 * the numbers of the facts it cites; the facts are listed below with their sources. Written on
 * request (it costs money) and then kept until a new filing changes the facts.
 */
export default function ExplainPanel({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const E = t.explain;
  const url = `/api/explain/${encodeURIComponent(symbol)}?lang=${lang}`;
  const { state, retry } = useResource<ExplainPayload>(url, { shared: true });
  const [writing, setWriting] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "error"; issue: ViewIssue | "rate_limited" }>({ kind: "idle" });
  const [written, setWritten] = useState<ExplainPayload | null>(null);

  if (state.status === "loading") {
    return (
      <Panel title={E.title} id="explain">
        <p role="status" className="sr-only">{t.ux.loading}</p>
        <Skeleton className="h-20 w-full rounded-lg" />
      </Panel>
    );
  }
  // No SEC data to explain (or the feature can't run here): the overview stays quiet about it.
  if (state.status === "error") {
    if (state.issue === "not_found" || state.issue === "not_configured") return null;
    return (
      <Panel title={E.title} id="explain">
        <IssueNote issue={state.issue} onRetry={retry} />
      </Panel>
    );
  }
  // A just-written explanation stands in until the next read, but only for this stock and language.
  const data = written && written.lang === lang && written.symbol === symbol ? written : state.data;
  // The feature is off on this site (no key): nothing to offer, so no panel saying so.
  if (!data.explanation && !data.canGenerate && data.why !== "daily_cap") return null;

  const write = async () => {
    setWriting({ kind: "busy" });
    let res: Response;
    try {
      res = await fetch(url, { method: "POST" });
    } catch {
      return setWriting({ kind: "error", issue: "upstream" });
    }
    const r = toViewResult<ExplainPayload>(res.status, await res.json().catch(() => null));
    if (!r.ok) return setWriting({ kind: "error", issue: r.error });
    sharedLoader.forget(url);
    setWritten(r.data);
    setWriting({ kind: "idle" });
  };

  return (
    <Panel title={E.title} description={E.intro} id="explain">
      {data.explanation ? (
        <div className="space-y-5">
          {data.explanation.quarter.length > 0 && <Section title={E.quarter} points={data.explanation.quarter} facts={data.facts} />}
          <div className="grid gap-5 md:grid-cols-2">
            {data.explanation.bull.length > 0 && <Section title={E.bull} points={data.explanation.bull} facts={data.facts} />}
            {data.explanation.bear.length > 0 && <Section title={E.bear} points={data.explanation.bear} facts={data.facts} />}
          </div>
          <Facts facts={data.facts} cited={citedIds(data)} />
          <p className="text-xs text-muted">
            {data.generatedAt && data.model && fill(E.written, { m: data.model, d: fmtAsOf(data.generatedAt, lang) })} {E.disclaimer}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.canGenerate ? (
            <>
              <p className="text-sm text-muted">{E.pending}</p>
              <button type="button" onClick={write} disabled={writing.kind === "busy"} className={buttonClass("secondary", true)}>
                {writing.kind === "busy" ? E.generating : E.generate}
              </button>
              {writing.kind === "busy" && (
                <p role="status" className="sr-only">
                  {E.generating}
                </p>
              )}
              {writing.kind === "error" && (
                <StatusMessage tone="warn">{writing.issue === "rate_limited" ? E.rateLimited : writing.issue === "beta_expired" ? t.data.betaExpired : E.failed}</StatusMessage>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">{E.dailyCap}</p>
          )}
          <p className="text-xs text-muted">{E.disclaimer}</p>
        </div>
      )}
    </Panel>
  );
}

const citedIds = (d: ExplainPayload) => new Set([...(d.explanation?.quarter ?? []), ...(d.explanation?.bull ?? []), ...(d.explanation?.bear ?? [])].flatMap((p) => p.facts));
const factNumber = (id: string) => id.replace(/^F/, "");

function Section({ title, points, facts }: { title: string; points: ExplainPoint[]; facts: Fact[] }) {
  const { t } = useI18n();
  const byId = new Map(facts.map((f) => [f.id, f]));
  return (
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 space-y-2 text-[15px] leading-relaxed">
        {points.map((p, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" aria-hidden="true" />
            <span>
              {p.text}{" "}
              {p.facts.map((id) => (
                <a
                  key={id}
                  href={`#fact-${id}`}
                  className="ml-0.5 inline-grid h-5 min-w-5 place-items-center rounded border border-line px-1 align-[1px] text-[11px] font-medium text-muted no-underline hover:border-line-strong hover:text-fg"
                  aria-label={fill(t.explain.cite, { n: factNumber(id), l: byId.get(id)?.label ?? id })}
                >
                  {factNumber(id)}
                </a>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Facts({ facts, cited }: { facts: Fact[]; cited: Set<string> }) {
  const { t } = useI18n();
  const shown = facts.filter((f) => cited.has(f.id));
  if (!shown.length) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold">{t.explain.facts}</h3>
      <ol className="mt-2 divide-y divide-line border-y border-line text-sm">
        {shown.map((f) => (
          <li key={f.id} id={`fact-${f.id}`} className="flex scroll-mt-24 gap-3 py-2 target:bg-panel-2">
            <span className="w-6 shrink-0 text-xs font-medium text-muted num">{factNumber(f.id)}</span>
            <span className="min-w-0 flex-1">
              <span className="block">
                {f.label}: <span className="font-medium num">{f.value}</span>
              </span>
              <span className="block text-xs text-muted">
                {f.href ? (
                  <a href={f.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                    {f.source}
                    <ExternalIcon size={11} />
                  </a>
                ) : (
                  f.source
                )}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
