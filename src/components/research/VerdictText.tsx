"use client";

// The plain-language reading of a quality verdict point (used by the plan builder's checks):
// the coloured mark of its level and the figures it rests on.
import { fill, type useI18n } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import type { VerdictLevel, VerdictPoint } from "@/lib/verdict";

type Lang = "es" | "en";
const PERCENT = new Set(["revenueGrowth", "epsGrowth", "roic", "roe", "equityToAssets", "fcfYield"]);

export function fmtMetric(metric: string, v: number, lang: Lang) {
  return PERCENT.has(metric) ? `${v < 0 ? "−" : ""}${fmtNum(Math.abs(v) * 100, lang, 1)}%` : `${fmtNum(v, lang, 1)}x`;
}

export function Mark({ level }: { level: VerdictLevel }) {
  const cls = level === "good" ? "rounded-full bg-up" : level === "weak" ? "rotate-45 rounded-[1px] bg-down" : "rounded-full border-[1.5px] border-muted";
  return <span className={`mt-[7px] inline-block h-2 w-2 shrink-0 ${cls}`} aria-hidden="true" />;
}

export function verdictEvidence(p: VerdictPoint, G: ReturnType<typeof useI18n>["t"]["glance"], lang: Lang): string {
  if (p.key === "quality") return fill(G.evidence.quality, { p: p.passed ?? 0, j: p.judged ?? 0 });
  if (p.note === "negativeEquity") return G.evidence.negativeEquity;
  if (!p.metric || p.value === undefined) return "";
  const m = G.metrics[p.metric as keyof typeof G.metrics];
  const value = fmtMetric(p.metric, p.value, lang);
  const compare = p.compare !== undefined ? fmtMetric(p.metric, p.compare, lang) : "—";
  if (p.key === "valuation") return fill(G.evidence.vsOwn, { m, v: value, c: compare });
  const base = fill(G.evidence.vsIndustry, { m, v: value, c: compare });
  return p.key === "growth" && p.cagr5 != null ? base + fill(G.evidence.cagr, { v: fmtMetric("revenueGrowth", p.cagr5, lang) }) : base;
}
