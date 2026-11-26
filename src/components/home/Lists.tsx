"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { useRecent } from "@/lib/watchlist";

export function RecentlyViewed() {
  const { t } = useI18n();
  const { list } = useRecent();
  if (list.length === 0) return null;
  return (
    <nav aria-label={t.ux.recent} className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
      <span className="mr-1 text-[13px] text-muted">{t.ux.recent}</span>
      {list.map((s) => (
        <Link
          key={s}
          href={`/stock/${encodeURIComponent(s)}`}
          prefetch={false}
          className="inline-flex items-center h-8 px-2.5 rounded-md border border-line text-[13px] font-medium hover:bg-panel-2 transition-colors"
        >
          {s}
        </Link>
      ))}
    </nav>
  );
}

