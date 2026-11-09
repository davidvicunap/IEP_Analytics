"use client";

import { useI18n } from "@/lib/i18n";
import type { Filing, FilingsPayload } from "@/lib/filingsShared";
import { useResource } from "@/lib/useResource";

/**
 * Filings of `symbol`: one shared request for every view that lists them (overview, News,
 * Financials, Filings); failures are not kept, so the next view asks again. Asking for
 * older filings keeps the current list on screen until the longer one arrives.
 */
export function useFilings(symbol: string, older = false) {
  return useResource<FilingsPayload>(`/api/sec/filings/${encodeURIComponent(symbol)}${older ? "?older=1" : ""}`, {
    shared: true,
    keepPrevious: older,
  });
}

/** Plain-language name for a form: our label, else the filer's own description, else the code. */
export function useFormLabel() {
  const { t } = useI18n();
  return (f: Pick<Filing, "form" | "description">) => t.filings.forms[f.form] ?? (f.description && f.description !== f.form ? f.description : f.form);
}
