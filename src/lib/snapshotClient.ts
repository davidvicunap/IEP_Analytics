"use client";

// Browser side of the watchlist dashboard's SEC summaries: one request per stock, at most
// three at a time so a long list doesn't flood the server (or the SEC behind it). Each row
// moves through loading → ok | error on its own; a retry asks again only for failed rows.
import { useCallback, useEffect, useState } from "react";
import { sharedLoader, type ViewIssue } from "./resource";
import type { SnapshotPayload } from "./snapshotShared";

export type SnapState = { status: "loading" } | { status: "ok"; data: SnapshotPayload; fetchedAt: string } | { status: "error"; issue: ViewIssue };

export const snapshotUrl = (symbol: string) => `/api/sec/snapshot/${encodeURIComponent(symbol)}`;

/** Runs at most `n` tasks at once, in the order they were queued. */
export function createLimiter(n: number) {
  let running = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (running >= n) return;
    const start = queue.shift();
    if (!start) return;
    running++;
    start();
  };
  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() =>
        task()
          .then(resolve, reject)
          .finally(() => {
            running--;
            next();
          }),
      );
      next();
    });
  };
}

const limit = createLimiter(3);

export function useSnapshots(symbols: string[], enabled = true): { state: Record<string, SnapState>; retry: () => void } {
  const [state, setState] = useState<Record<string, SnapState>>({});
  const [round, setRound] = useState(0);
  const key = symbols.join(",");
  useEffect(() => {
    if (!enabled || !key) return;
    let alive = true;
    const list = key.split(",");
    // Rows already loaded stay; new and failed ones (on a retry) load again.
    setState((prev) => Object.fromEntries(list.map((s) => [s, prev[s]?.status === "ok" ? prev[s] : { status: "loading" }])));
    for (const s of list) {
      limit(async () => {
        if (!alive) return;
        const r = await sharedLoader.load<SnapshotPayload>(snapshotUrl(s));
        if (!alive) return;
        setState((prev) => {
          if (prev[s]?.status === "ok") return prev;
          return { ...prev, [s]: r.ok ? { status: "ok", data: r.data, fetchedAt: r.fetchedAt } : { status: "error", issue: r.error } };
        });
      });
    }
    return () => {
      alive = false;
    };
  }, [key, enabled, round]);
  const retry = useCallback(() => setRound((n) => n + 1), []);
  return { state, retry };
}
