// Server-side: the AI explanation of a stock. Facts come from SEC data the rest of the app
// already shows ("At a glance" and the quarter in review). An explanation is written once per
// stock, language and set of facts and then served from the database, so Claude is called again
// only when a new filing changes the facts. New ones are capped per day (CLAUDE_DAILY_LIMIT) and
// per person (rate limit in the route). Without ANTHROPIC_API_KEY the feature says it's off.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { explanations } from "@/db/schema";
import { isDemo } from "./data";
import { ExplanationSchema, MIN_FACTS, acceptExplanation, buildFacts, factsHash, systemPrompt, userPrompt, type Explanation, type Fact, type Lang } from "./explain";
import { getFinancials } from "./financials";
import { quarterReview } from "./quarterReview";
import { getSecurity } from "./securities";
import { providerCallsToday, providerDailyLimit, recordProviderCall } from "./quota";
import type { DataIssue, Result } from "./types";
import { getVerdict } from "./verdictData";

export const EXPLAIN_MODEL = "claude-opus-5-5";

export interface ExplainPayload {
  symbol: string;
  lang: Lang;
  facts: Fact[];
  /** Null until one has been written for these facts (the page offers to write it). */
  explanation: Explanation | null;
  generatedAt: string | null;
  model: string | null;
  /** False when new explanations can't be written now: no API key, or today's cap reached. */
  canGenerate: boolean;
  why?: "not_configured" | "daily_cap";
}

interface Stored {
  explanation: Explanation;
  generatedAt: string;
  model: string;
}

export interface ExplainStore {
  get(symbol: string, lang: Lang, hash: string): Promise<Stored | null>;
  put(symbol: string, lang: Lang, hash: string, value: Stored, facts: Fact[]): Promise<void>;
}

function postgresStore(db: Db): ExplainStore {
  return {
    async get(symbol, lang, hash) {
      const [row] = await db
        .select()
        .from(explanations)
        .where(and(eq(explanations.symbol, symbol), eq(explanations.lang, lang), eq(explanations.factsHash, hash)))
        .limit(1);
      if (!row) return null;
      const body = row.body as { explanation: Explanation };
      return { explanation: body.explanation, generatedAt: row.createdAt.toISOString(), model: row.model };
    },
    async put(symbol, lang, hash, v, facts) {
      await db
        .insert(explanations)
        .values({ symbol, lang, factsHash: hash, body: { facts, explanation: v.explanation }, model: v.model, createdAt: new Date(v.generatedAt) })
        .onConflictDoNothing();
    },
  };
}

const memory = new Map<string, Stored>();
const memoryStore: ExplainStore = {
  async get(symbol, lang, hash) {
    return memory.get(`${symbol}|${lang}|${hash}`) ?? null;
  },
  async put(symbol, lang, hash, v) {
    memory.set(`${symbol}|${lang}|${hash}`, v);
  },
};

export function explainStore(): ExplainStore | null {
  const db = getDb();
  if (db) return postgresStore(db);
  return isDemo() ? memoryStore : null;
}

/** The facts for a stock, from SEC data (never from demo prices). */
async function loadFacts(symbol: string, lang: Lang): Promise<Result<{ facts: Fact[]; name: string | null }>> {
  const db = getDb();
  const [verdict, fin, security] = await Promise.all([getVerdict(symbol), getFinancials(symbol), db ? getSecurity(db, symbol).catch(() => null) : null]);
  if (!verdict.ok && !fin.ok) return { ok: false, error: fin.error };
  const quarter = fin.ok ? quarterReview(fin.data.quarterly, fin.data.shares.splits) : null;
  const name = security?.name ?? null;
  const facts = buildFacts(
    {
      symbol,
      name,
      cik: fin.ok ? fin.data.cik : null,
      verdict: verdict.ok ? { points: verdict.data.points, fiscal: verdict.data.fiscal, industry: verdict.data.industry } : null,
      quarter,
    },
    lang,
  );
  if (facts.length < MIN_FACTS) return { ok: false, error: "not_found" };
  return { ok: true, data: { facts, name }, fetchedAt: new Date().toISOString() };
}

export type Writer = (symbol: string, name: string | null, facts: Fact[], lang: Lang) => Promise<Result<Explanation>>;

/** Asks Claude for the three sections as structured output, and keeps only cited points. */
export const claudeWriter: Writer = async (symbol, name, facts, lang) => {
  const client = new Anthropic();
  try {
    const res = await client.beta.messages.parse({
      model: EXPLAIN_MODEL,
      max_tokens: 16000,
      // A summary of given facts: medium effort is plenty. Refusals fall back server-side.
      output_config: { effort: "medium", format: betaZodOutputFormat(ExplanationSchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: systemPrompt(lang),
      messages: [{ role: "user", content: userPrompt(symbol, name, facts) }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) {
      console.error(JSON.stringify({ event: "explain_unusable", symbol, stop: res.stop_reason }));
      return { ok: false, error: "upstream" };
    }
    const explanation = acceptExplanation(res.parsed_output, facts);
    if (!explanation.bull.length && !explanation.bear.length && !explanation.quarter.length) return { ok: false, error: "upstream" };
    return { ok: true, data: explanation, fetchedAt: new Date().toISOString() };
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    console.error(JSON.stringify({ event: "explain_error", symbol, status, message: e instanceof Error ? e.message : String(e) }));
    const error: DataIssue = e instanceof Anthropic.RateLimitError ? "rate_limited" : e instanceof Anthropic.AuthenticationError ? "unauthorized" : "upstream";
    return { ok: false, error };
  }
};

const configured = () => !!process.env.ANTHROPIC_API_KEY;

/**
 * True when today's cap is reached, or when the counter can't be read: without it the cap can't
 * be enforced, so no new explanations are written (stored ones are still shown). Demo mode has
 * no counter and no real cost.
 */
async function capReached(): Promise<boolean> {
  const calls = await providerCallsToday("claude");
  if (calls === null) {
    if (isDemo()) return false;
    console.warn(JSON.stringify({ event: "explain_cap_unavailable" }));
    return true;
  }
  return calls >= providerDailyLimit(process.env, "claude");
}

/**
 * The stored explanation for the current facts, if any; with `write`, writes one when missing
 * (unless the feature is off or today's cap is reached, which the payload says).
 */
export async function getExplanation(symbol: string, lang: Lang, opts: { write: boolean; writer?: Writer; store?: ExplainStore | null } = { write: false }): Promise<Result<ExplainPayload>> {
  const store = opts.store === undefined ? explainStore() : opts.store;
  if (!store) return { ok: false, error: "not_configured" };
  const loaded = await loadFacts(symbol, lang);
  if (!loaded.ok) return loaded;
  const { facts, name } = loaded.data;
  const hash = factsHash(facts, lang);
  const now = new Date().toISOString();
  const base = { symbol, lang, facts };
  const hasKey = configured() || !!opts.writer;
  const stored = await store.get(symbol, lang, hash);
  if (stored) return { ok: true, fetchedAt: now, data: { ...base, ...stored, canGenerate: hasKey } };

  const capped = hasKey && (await capReached());
  const idle: ExplainPayload = { ...base, explanation: null, generatedAt: null, model: null, canGenerate: hasKey && !capped, ...(hasKey ? (capped ? { why: "daily_cap" as const } : {}) : { why: "not_configured" as const }) };
  if (!opts.write || !idle.canGenerate) return { ok: true, fetchedAt: now, data: idle };

  await recordProviderCall("claude");
  const written = await (opts.writer ?? claudeWriter)(symbol, name, facts, lang);
  if (!written.ok) return written;
  const value: Stored = { explanation: written.data, generatedAt: now, model: EXPLAIN_MODEL };
  await store.put(symbol, lang, hash, value, facts);
  return { ok: true, fetchedAt: now, data: { ...base, ...value, canGenerate: true } };
}
