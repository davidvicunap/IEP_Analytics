"use client";

import { useI18n } from "@/lib/i18n";
import { fmtAsOf } from "@/lib/format";
import { useSyncStatus } from "@/lib/prefsSync";

/** Where your lists and settings are saved right now, in one quiet line. */
export default function SyncNote({ className = "" }: { className?: string }) {
  const { t, lang } = useI18n();
  const s = useSyncStatus();
  const Y = t.sync;
  const text =
    s.kind === "synced"
      ? `${Y.synced} · ${fmtAsOf(s.at, lang)}`
      : s.kind === "syncing"
        ? Y.syncing
        : s.kind === "local"
          ? Y.local
          : s.kind === "error"
            ? s.issue === "beta_expired"
              ? Y.expired
              : Y.error
            : null;
  if (!text) return null;
  return (
    <span role="status" className={`text-muted ${className}`} data-sync={s.kind}>
      {text}
    </span>
  );
}
