"use client";

// Browser side of the research notebook. Reading uses the shared resource machine (one
// request per stock for the header, overview card and tab); after a save every view of that
// stock reads it again, so they never disagree.
import { useEffect } from "react";
import type { NoteInput, ResearchNote } from "./research";
import { sharedLoader, toViewResult, type ViewIssue } from "./resource";
import { useResource } from "./useResource";

export const noteUrl = (symbol: string) => `/api/research/${encodeURIComponent(symbol)}`;
export const NOTES_URL = "/api/research";

const listeners = new Set<(symbol: string) => void>();
function changed(symbol: string) {
  sharedLoader.forget(noteUrl(symbol));
  sharedLoader.forget(NOTES_URL);
  for (const l of listeners) l(symbol);
}

function useRefreshOn(match: (symbol: string) => boolean, retry: () => void) {
  useEffect(() => {
    const l = (s: string) => match(s) && retry();
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [match, retry]);
}

const any = () => true;

/** The user's notebook for `symbol` (empty, `updatedAt: null`, until they save something). */
export function useNote(symbol: string) {
  const r = useResource<ResearchNote>(noteUrl(symbol), { shared: true, keepPrevious: true });
  useRefreshOn(useMatch(symbol), r.retry);
  return r;
}

/** All of the user's notebooks, most recently edited first. */
export function useNotes() {
  const r = useResource<ResearchNote[]>(NOTES_URL, { shared: true, keepPrevious: true });
  useRefreshOn(any, r.retry);
  return r;
}

const matchers = new Map<string, (s: string) => boolean>();
function useMatch(symbol: string) {
  let m = matchers.get(symbol);
  if (!m) matchers.set(symbol, (m = (s: string) => s === symbol));
  return m;
}

export type SaveIssue = ViewIssue | "conflict" | "invalid";

/** Applies an edit; on success every view of this stock reloads the saved note. */
export async function saveNote(symbol: string, input: NoteInput): Promise<{ ok: true; note: ResearchNote } | { ok: false; error: SaveIssue }> {
  let res: Response;
  try {
    res = await fetch(noteUrl(symbol), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  } catch {
    return { ok: false, error: "upstream" };
  }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (res.status === 409) return { ok: false, error: "conflict" };
  if (res.status === 400) return { ok: false, error: "invalid" };
  const r = toViewResult<ResearchNote>(res.status, body);
  if (!r.ok) return { ok: false, error: r.error };
  changed(symbol);
  return { ok: true, note: r.data };
}
