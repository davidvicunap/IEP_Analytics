// Server side of the research notebook: who is asking (the beta invite's label) and where
// their notebooks are stored.
import { getDb } from "@/db/client";
import { BETA_COOKIE, isGateEnabled, parseInviteCodes, verifyToken } from "./beta";
import { isDemo } from "./data";
import { memoryStore, postgresStore, type ResearchStore } from "./researchStore";

/**
 * The notebook owner: the label of the invite code in the beta cookie ("david" in
 * "david:IEP-…"), so each invited person has their own notes on every device. Renaming a
 * label in BETA_INVITE_CODES starts that person on an empty notebook. With the gate off
 * (local development) everyone is "local". Null: no valid invite.
 */
export async function notebookOwner(cookies: { get(name: string): { value: string } | undefined }): Promise<string | null> {
  if (!isGateEnabled()) return "local";
  const invite = await verifyToken(cookies.get(BETA_COOKIE)?.value, parseInviteCodes(process.env.BETA_INVITE_CODES));
  return invite?.label ?? null;
}

let demoStore: ResearchStore | null = null;

/** Postgres when configured; in demo mode without a database, an in-memory store. */
export function researchStore(): ResearchStore | null {
  const db = getDb();
  if (db) return postgresStore(db);
  if (isDemo()) return (demoStore ??= memoryStore());
  return null;
}

/** Writes must come from our own pages (the cookie is SameSite=Lax; this is a second check). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers may omit it
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
