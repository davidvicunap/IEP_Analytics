"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { INITIAL, fetchViewResult, reduce, sharedLoader, type Resource, type ResourceEvent } from "./resource";

export interface ResourceOptions<T> {
  /** Keep the last data on screen while a new URL loads (state is `loading` with `previous`). */
  keepPrevious?: boolean;
  /** Share one request per URL across views; failures are not kept. */
  shared?: boolean;
  /** Fetch again in the background while this holds (e.g. more filings to read), up to `maxPasses` reads. */
  again?: (data: T) => boolean;
  maxPasses?: number;
  againMs?: number;
}

/**
 * Reads one of our JSON APIs as a `Resource<T>` (see resource.ts for the state machine).
 * - A new URL or `retry()` starts over; an older response never overwrites a newer one.
 * - Requests are aborted (or ignored, when shared) on URL change and unmount.
 * - A background pass that fails keeps the data already shown and stops polling.
 */
export function useResource<T>(url: string, opts: ResourceOptions<T> = {}): { state: Resource<T>; retry: () => void } {
  const { keepPrevious = false, shared = false, again, maxPasses = 1, againMs = 1000 } = opts;
  const [state, dispatch] = useReducer(reduce as (s: Resource<T>, e: ResourceEvent<T>) => Resource<T>, INITIAL as Resource<T>);
  const [attempt, setAttempt] = useState(0);
  // `again` is usually an inline arrow: read the latest one without restarting the request.
  const againRef = useRef(again);
  useEffect(() => {
    againRef.current = again;
  });

  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let passes = 0;
    dispatch({ type: "start", keepPrevious });

    const read = (background: boolean) => {
      passes++;
      const p = shared && !background ? sharedLoader.load<T>(url) : fetchViewResult<T>(url, ctrl.signal);
      p.then((result) => {
        if (ctrl.signal.aborted) return;
        if (background && !result.ok) return; // keep what's on screen
        dispatch({ type: "settle", result });
        if (result.ok && passes < maxPasses && againRef.current?.(result.data)) timer = setTimeout(() => read(true), againMs);
      }).catch(() => {}); // aborted: a newer request owns the state
    };
    read(false);

    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [url, attempt, keepPrevious, shared, maxPasses, againMs]);

  const retry = useCallback(() => {
    if (shared) sharedLoader.forget(url);
    setAttempt((n) => n + 1);
  }, [shared, url]);

  return { state, retry };
}
