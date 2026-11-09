// The "remote resource" state machine: one read of one of our JSON APIs, as a view sees it.
//
//   loading ──settle(ok)──▶ ok
//   loading ──settle(err)─▶ error
//   ok/error ──start──────▶ loading      (new URL or retry; `previous` keeps the last ok data
//                                         when the view asked to keep it on screen)
//   ok ──settle(ok)───────▶ ok           (background continuation, e.g. insiders' next batch)
//
// Pure (no React, no DOM): the hook in useResource.ts drives it, tests exercise it directly.
// See docs/state-machines.md for every other state machine in the app.
import type { DataIssue, Result } from "./types";

/** Why a view has no data. `beta_expired` is the gate's 401: the user must sign in again. */
export type ViewIssue = DataIssue | "beta_expired";

/** A Result as a view receives it: our envelope, or the gate saying the session expired. */
export type ViewResult<T> = { ok: true; data: T; fetchedAt: string } | { ok: false; error: ViewIssue };

export type Resource<T> =
  | { status: "loading"; previous: { data: T; fetchedAt: string } | null }
  | { status: "ok"; data: T; fetchedAt: string }
  | { status: "error"; issue: ViewIssue };

export type ResourceEvent<T> = { type: "start"; keepPrevious: boolean } | { type: "settle"; result: ViewResult<T> };

export const INITIAL: Resource<never> = { status: "loading", previous: null };

export function reduce<T>(state: Resource<T>, event: ResourceEvent<T>): Resource<T> {
  switch (event.type) {
    case "start": {
      if (!event.keepPrevious) return { status: "loading", previous: null };
      if (state.status === "ok") return { status: "loading", previous: { data: state.data, fetchedAt: state.fetchedAt } };
      return { status: "loading", previous: state.status === "loading" ? state.previous : null };
    }
    case "settle":
      return event.result.ok
        ? { status: "ok", data: event.result.data, fetchedAt: event.result.fetchedAt }
        : { status: "error", issue: event.result.error };
  }
}

/** The data a view can show: the current value, or the previous one while reloading. */
export function shown<T>(r: Resource<T>): { data: T; fetchedAt: string } | null {
  if (r.status === "ok") return r;
  if (r.status === "loading") return r.previous;
  return null;
}

/** Issues worth a "Try again" button: transient ones. The rest won't change on a retry. */
export function isRetryable(issue: ViewIssue): boolean {
  return issue === "upstream" || issue === "rate_limited";
}

const DATA_ISSUES = new Set<DataIssue>(["not_configured", "not_found", "plan_restricted", "rate_limited", "unauthorized", "upstream"]);

/**
 * Reads any response from our API as a ViewResult:
 * - our `Result` envelope is trusted as is (whatever the HTTP status);
 * - otherwise it came from the edge: 401 is the beta gate (session expired), 429 the rate limit;
 * - anything else unreadable is `upstream`.
 * Data routes never answer 401 themselves, so a bare 401 can only mean the gate.
 */
export function toViewResult<T>(status: number, body: unknown): ViewResult<T> {
  if (body && typeof body === "object" && "ok" in body) return body as Result<T>;
  if (status === 401) return { ok: false, error: "beta_expired" };
  if (status === 429) return { ok: false, error: "rate_limited" };
  const error = body && typeof body === "object" && "error" in body ? (body as { error: unknown }).error : null;
  return { ok: false, error: DATA_ISSUES.has(error as DataIssue) ? (error as DataIssue) : "upstream" };
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** GET `url` and read it as a ViewResult. Network failures are `upstream`; aborts reject. */
export async function fetchViewResult<T>(url: string, signal?: AbortSignal, fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<ViewResult<T>> {
  let res: Response;
  try {
    res = await fetcher(url, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    return { ok: false, error: "upstream" };
  }
  const body = await res.json().catch(() => null);
  return toViewResult<T>(res.status, body);
}

/**
 * One request per URL for every view that needs it (e.g. filings on four tabs). Successful
 * results are kept for the page's life; failures are dropped so the next view asks again.
 */
export function createSharedLoader(fetcher?: Fetcher) {
  const inflight = new Map<string, Promise<ViewResult<unknown>>>();
  return {
    load<T>(url: string): Promise<ViewResult<T>> {
      let p = inflight.get(url) as Promise<ViewResult<T>> | undefined;
      if (!p) {
        p = fetchViewResult<T>(url, undefined, fetcher);
        inflight.set(url, p as Promise<ViewResult<unknown>>);
        p.then((r) => {
          if (!r.ok && inflight.get(url) === (p as Promise<ViewResult<unknown>>)) inflight.delete(url);
        });
      }
      return p;
    },
    forget(url: string) {
      inflight.delete(url);
    },
  };
}

export const sharedLoader = createSharedLoader();
