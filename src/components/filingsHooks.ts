"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { Filing, FilingsPayload } from "@/lib/filingsShared";
import type { Result } from "@/lib/types";

// One request per symbol for every view that lists filings (overview, News, Financials,
// Filings). Failures are not kept, so the next view asks again.
const cache = new Map<string, Promise<Result<FilingsPayload>>>();

function load(symbol: string, older: boolean): Promise<Result<FilingsPayload>> {
  const key = `${symbol}|${older ? 1 : 0}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`/api/sec/filings/${encodeURIComponent(symbol)}${older ? "?older=1" : ""}`)
      .then(async (res) => ((await res.json().catch(() => null)) as Result<FilingsPayload> | null) ?? { ok: false as const, error: "upstream" as const })
      .catch(() => ({ ok: false as const, error: "upstream" as const }));
    p.then((r) => {
      if (!r.ok) cache.delete(key);
    });
    cache.set(key, p);
  }
  return p;
}

export function useFilings(symbol: string, older = false) {
  const [state, setState] = useState<Result<FilingsPayload> | null>(null);
  useEffect(() => {
    let alive = true;
    load(symbol, older).then((r) => alive && setState(r));
    return () => {
      alive = false;
    };
  }, [symbol, older]);
  return state;
}

/** Plain-language name for a form: our label, else the filer's own description, else the code. */
export function useFormLabel() {
  const { t } = useI18n();
  return (f: Pick<Filing, "form" | "description">) => t.filings.forms[f.form] ?? (f.description && f.description !== f.form ? f.description : f.form);
}
