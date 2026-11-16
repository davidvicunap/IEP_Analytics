"use client";

import Link from "next/link";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtDate, fmtNum } from "@/lib/format";
import type { VerdictKey, VerdictLevel, VerdictPoint } from "@/lib/verdict";
import type { VerdictPayload } from "@/lib/verdictData";
import { useResource } from "@/lib/useResource";
import { ChevronRightIcon } from "./icons";
import { IssueNote, Panel, Skeleton } from "./ui";

type Lang = "es" | "en";
const PERCENT = new Set(["revenueGrowth", "epsGrowth", "roic", "roe", "equityToAssets", "fcfYield"]);
const TAB: Record<VerdictKey, "business" | "valuation"> = { quality: "business", growth: "business", profitability: "business", debt: "business", valuation: "valuation" };

function fmtMetric(metric: string, v: number, lang: Lang) {
  return PERCENT.has(metric) ? `${v < 0 ? "−" : ""}${fmtNum(Math.abs(v) * 100, lang, 1)}%` : `${fmtNum(v, lang, 1)}x`;
}

/** Good: filled circle; in line: hollow circle; weak: diamond. Shape and colour, never colour alone. */
function Mark({ level }: { level: VerdictLevel }) {
  const cls = level === "good" ? "rounded-full bg-up" : level === "weak" ? "rotate-45 rounded-[1px] bg-down" : "rounded-full border-[1.5px] border-muted";
  return <span className={`mt-[7px] inline-block h-2 w-2 shrink-0 ${cls}`} aria-hidden="true" />;
}

/**
 * The overview's verdict: five plain sentences, each with the number behind it and the
 * yardstick it's measured against. Every line opens the tab with the detail.
 */
export default function AtAGlance({ symbol, onOpen }: { symbol: string; onOpen: (tab: "business" | "valuation") => void }) {
  const { t, lang } = useI18n();
  const G = t.glance;
  const { state, retry } = useResource<VerdictPayload>(`/api/verdict/${encodeURIComponent(symbol)}`, { shared: true });

  if (state.status === "loading") {
    return (
      <Panel title={G.title} id="glance">
        <p role="status" className="sr-only">{G.loading}</p>
        <div className="space-y-4" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-4" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </Panel>
    );
  }
  if (state.status === "error") {
    return (
      <Panel title={G.title} id="glance">
        <IssueNote issue={state.issue} onRetry={retry} />
      </Panel>
    );
  }
  const v = state.data;
  const evidence = (p: VerdictPoint): string => {
    if (p.key === "quality") return fill(G.evidence.quality, { p: p.passed ?? 0, j: p.judged ?? 0 });
    if (p.note === "negativeEquity") return G.evidence.negativeEquity;
    if (!p.metric || p.value === undefined) return "";
    const m = G.metrics[p.metric as keyof typeof G.metrics];
    const value = fmtMetric(p.metric, p.value, lang);
    const compare = p.compare !== undefined ? fmtMetric(p.metric, p.compare, lang) : "—";
    if (p.key === "valuation") return fill(G.evidence.vsOwn, { m, v: value, c: compare });
    const base = fill(G.evidence.vsIndustry, { m, v: value, c: compare });
    return p.key === "growth" && p.cagr5 != null ? base + fill(G.evidence.cagr, { v: fmtMetric("revenueGrowth", p.cagr5, lang) }) : base;
  };

  return (
    <Panel title={G.title} id="glance">
      <ul className="-mx-2 space-y-0.5">
        {v.points.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              onClick={() => onOpen(TAB[p.key])}
              className="group flex w-full min-h-11 items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-panel-2"
            >
              <Mark level={p.level} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-snug">{p.note === "negativeEquity" ? G.lines.debt.negativeEquity : G.lines[p.key][p.level]}</span>
                <span className="num mt-0.5 block text-xs text-muted">{evidence(p)}</span>
              </span>
              <ChevronRightIcon size={16} className="mt-1 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
          </li>
        ))}
      </ul>
      {v.missing.length > 0 && (
        <p className="mt-3 text-xs text-muted">{fill(G.missing, { list: v.missing.map((k) => G.names[k]).join(", ") })}</p>
      )}
      <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-muted">
        {v.fiscal && fill(G.sourceBusiness, { fy: v.fiscal, ind: v.industry ? v.industry.toLowerCase() : G.sameIndustry })}
        {v.priceAt && v.historyFrom && ` ${fill(G.sourceValuation, { d: fmtAsOf(v.priceAt, lang), from: fmtDate(v.historyFrom, lang) })}`}{" "}
        <Link href="/methodology#glance" className="link">
          {G.how}
        </Link>
      </p>
    </Panel>
  );
}
