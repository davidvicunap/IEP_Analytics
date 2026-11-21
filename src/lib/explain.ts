// "Explained by AI": what changed in the last quarter and the case for and against, written by
// Claude from a numbered sheet of facts we already show elsewhere (SEC filings). Every sentence
// must cite the facts it rests on; a sentence that cites nothing we gave it is dropped, so the
// page never shows a claim without its number. Pure: the call and the cache are in explainData.ts.
import { z } from "zod";
import type { QuarterMetric, QuarterReview } from "./quarterReview";
import type { VerdictKey, VerdictPoint } from "./verdict";

export type Lang = "es" | "en";
export const MAX_POINTS = 4;
export const MIN_FACTS = 3;

export interface Fact {
  id: string; // "F1"
  label: string;
  value: string;
  /** Where it comes from, in words ("10-Q filed on 2026-10-31"), and a link when there is one. */
  source: string;
  href?: string;
  /** For a value that moves with the price: what the fingerprint uses instead (its level). */
  stable?: string;
}

export interface FactInput {
  symbol: string;
  name: string | null;
  cik: number | null;
  verdict: { points: VerdictPoint[]; fiscal: string | null; industry: string | null } | null;
  quarter: QuarterReview | null;
}

const L = {
  es: {
    quarter: { revenue: "Ingresos", grossMargin: "Margen bruto", operatingMargin: "Margen operativo", netIncome: "Beneficio neto", eps: "BPA (beneficio por acción)", freeCashFlow: "Flujo de caja libre" },
    vsYearAgo: "frente a {p}",
    points: "pts",
    filed: "{f} presentado el {d}",
    tenK: "10-K {fy}",
    glance: {
      quality: "Pruebas de calidad (Buffett) superadas",
      growth: "Crecimiento de ingresos frente a la mediana de su industria",
      profitability: "Rentabilidad frente a la mediana de su industria",
      debt: "Deuda frente a la mediana de su industria",
      valuation: "Múltiplo de hoy frente a su media de 5 años",
    },
    level: { good: "bien", mid: "en línea", weak: "débil" },
    of: "{p} de {j}",
    industry: "industria: {i}",
    ownHistory: "precio de Financial Modeling Prep y cifras de la SEC",
  },
  en: {
    quarter: { revenue: "Revenue", grossMargin: "Gross margin", operatingMargin: "Operating margin", netIncome: "Net income", eps: "EPS (earnings per share)", freeCashFlow: "Free cash flow" },
    vsYearAgo: "vs {p}",
    points: "pts",
    filed: "{f} filed on {d}",
    tenK: "10-K {fy}",
    glance: {
      quality: "Quality tests (Buffett) passed",
      growth: "Revenue growth against its industry median",
      profitability: "Profitability against its industry median",
      debt: "Debt against its industry median",
      valuation: "Today's multiple against its 5-year average",
    },
    level: { good: "good", mid: "in line", weak: "weak" },
    of: "{p} of {j}",
    industry: "industry: {i}",
    ownHistory: "price from Financial Modeling Prep and SEC figures",
  },
} as const;

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
const num = (v: number, lang: Lang, d = 1) => new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { maximumFractionDigits: d }).format(v);
const pct = (v: number, lang: Lang) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v) * 100, lang)}%`;
const money = (v: number, lang: Lang) => {
  const a = Math.abs(v);
  const s = a >= 1e12 ? `${num(a / 1e12, lang)}T` : a >= 1e9 ? `${num(a / 1e9, lang)}B` : a >= 1e6 ? `${num(a / 1e6, lang)}M` : num(a, lang, 2);
  return `${v < 0 ? "−" : ""}$${s}`;
};
const PERCENT_METRICS = new Set(["revenueGrowth", "epsGrowth", "roic", "roe", "equityToAssets", "fcfYield", "grossMargin", "operatingMargin", "netMargin", "fcfMargin", "roa"]);
const metric = (m: string, v: number, lang: Lang) => (PERCENT_METRICS.has(m) ? `${v < 0 ? "−" : ""}${num(Math.abs(v) * 100, lang)}%` : `${num(v, lang)}x`);
const filingUrl = (cik: number, accn: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}/`;

/** The numbered facts the explanation may use, in the reader's language. */
export function buildFacts(input: FactInput, lang: Lang): Fact[] {
  const T = L[lang];
  const facts: Omit<Fact, "id">[] = [];
  const q = input.quarter;
  if (q) {
    const source = q.filing?.form && q.filing.filed ? fill(T.filed, { f: q.filing.form, d: q.filing.filed }) : q.label;
    const href = q.filing && input.cik ? filingUrl(input.cik, q.filing.accn) : undefined;
    const vs = fill(T.vsYearAgo, { p: q.yearAgoLabel ?? "" }).trim();
    for (const r of q.rows) {
      if (r.now === null) continue;
      const isMargin = r.key === "grossMargin" || r.key === "operatingMargin";
      const now = isMargin ? metric("grossMargin", r.now, lang) : r.key === "eps" ? `$${num(r.now, lang, 2)}` : money(r.now, lang);
      let change = "";
      if (r.vsYearAgo !== null) {
        change = isMargin ? ` (${r.vsYearAgo >= 0 ? "+" : "−"}${num(Math.abs(r.vsYearAgo) * 100, lang)} ${T.points} ${vs})` : ` (${pct(r.vsYearAgo, lang)} ${vs})`;
      }
      facts.push({ label: `${T.quarter[r.key as QuarterMetric]} · ${q.label}`, value: now + change, source, href });
    }
  }
  const v = input.verdict;
  if (v) {
    for (const p of v.points) {
      const label = T.glance[p.key as VerdictKey];
      let value: string;
      if (p.key === "quality") value = fill(T.of, { p: p.passed ?? 0, j: p.judged ?? 0 });
      else if (p.metric && p.value !== undefined) value = `${metric(p.metric, p.value, lang)}${p.compare !== undefined ? ` / ${metric(p.metric, p.compare, lang)}` : ""}`;
      else continue;
      const parts = p.key === "valuation" ? [T.ownHistory] : [v.fiscal ? fill(T.tenK, { fy: v.fiscal }) : null, v.industry && p.key !== "quality" ? fill(T.industry, { i: v.industry }) : null];
      // Today's multiple moves with the price every day; only its level changes the explanation.
      facts.push({ label, value: `${value} (${T.level[p.level]})`, source: parts.filter(Boolean).join(" · "), ...(p.key === "valuation" ? { stable: p.level } : {}) });
    }
  }
  return facts.map((f, i) => ({ id: `F${i + 1}`, ...f }));
}

// ---- What we ask Claude for, and what we accept back --------------------------------------------

const Point = z.object({
  text: z.string().describe("One or two plain sentences."),
  facts: z.array(z.string()).describe('Ids of the facts this sentence rests on, e.g. ["F2", "F5"].'),
});
export const ExplanationSchema = z.object({
  quarter: z.array(Point).describe("What changed in the latest quarter. Empty if there are no quarter facts."),
  bull: z.array(Point).describe("Points in favour of the business, from the facts."),
  bear: z.array(Point).describe("Points against, or risks, from the facts."),
});
export type RawExplanation = z.infer<typeof ExplanationSchema>;
export interface ExplainPoint {
  text: string;
  facts: string[];
}
export interface Explanation {
  quarter: ExplainPoint[];
  bull: ExplainPoint[];
  bear: ExplainPoint[];
}

export function systemPrompt(lang: Lang): string {
  const language = lang === "es" ? "Spanish (neutral Latin American, addressing the reader as «tú»)" : "English";
  return [
    `You explain a US-listed company's numbers to retail investors who are learning. Write in ${language}.`,
    "Use only the numbered facts you are given. Every sentence must rest on at least one of them; list their ids in `facts`. Don't bring in outside knowledge, news, guesses about the future, or numbers that aren't in the facts.",
    `Plain words, one idea per point; explain any term a beginner wouldn't know in a few words. Up to ${MAX_POINTS} points per section; fewer is fine when the facts don't support more.`,
    "This is education, not advice: never tell the reader to buy, sell or hold, never predict the price, and don't call the stock cheap or expensive beyond what a fact states.",
    "Don't write fact ids inside the text; they go in `facts`.",
  ].join("\n");
}

export function userPrompt(symbol: string, name: string | null, facts: Fact[]): string {
  const lines = facts.map((f) => `${f.id}. ${f.label}: ${f.value} — ${f.source}`);
  return `Company: ${name ? `${name} (${symbol})` : symbol}\n\nFacts:\n${lines.join("\n")}\n\nWrite the three sections.`;
}

const ID_IN_TEXT = /\s*\[?\(?\bF\d+\b(?:\s*,\s*F\d+)*\)?\]?/g;

/** Keeps only points that cite facts we gave (ids cleaned and de-duplicated), at most MAX_POINTS each. */
export function acceptExplanation(raw: RawExplanation, facts: Fact[]): Explanation {
  const known = new Set(facts.map((f) => f.id));
  const clean = (points: RawExplanation["quarter"]) =>
    points
      .map((p) => ({ text: p.text.replace(ID_IN_TEXT, "").trim(), facts: [...new Set(p.facts.map((f) => f.trim().toUpperCase()))].filter((f) => known.has(f)) }))
      .filter((p) => p.text.length > 0 && p.facts.length > 0)
      .slice(0, MAX_POINTS);
  return { quarter: clean(raw.quarter), bull: clean(raw.bull), bear: clean(raw.bear) };
}

/**
 * A short stable fingerprint of the facts: a new filing (new facts) means a new explanation.
 * Price-driven values count by their level, so a day's move doesn't call Claude again.
 */
export function factsHash(facts: Fact[], lang: Lang): string {
  const s = `${lang}|${facts.map((f) => `${f.label}=${f.stable ?? f.value}@${f.source}`).join("|")}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + s.length.toString(36);
}
