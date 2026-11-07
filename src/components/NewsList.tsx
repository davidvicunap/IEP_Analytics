"use client";

import { useI18n } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import type { NewsItem, Result } from "@/lib/types";
import { IssueNote } from "./ui";

export default function NewsList({ news: result, limit }: { news: Result<NewsItem[]>; limit?: number }) {
  const { t, lang } = useI18n();
  if (!result.ok) return <IssueNote issue={result.error} />;
  const news = result.data;
  if (news.length === 0) return <p className="text-sm text-muted">{t.stock.noNews}</p>;
  return (
    <ul className="divide-y divide-line">
      {news.slice(0, limit).map((n) => (
        <li key={n.url + n.title}>
          <a href={n.url} target="_blank" rel="noopener noreferrer" className="flex gap-3 py-3 group">
            {n.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={n.image} alt="" loading="lazy" className="h-16 w-24 shrink-0 rounded object-cover bg-panel-2" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium group-hover:text-accent line-clamp-2">{n.title}</p>
              <p className="text-xs text-muted mt-1">
                {n.publisher && <>{n.publisher} · </>}
                {n.publishedDate && fmtDate(n.publishedDate, lang)}
              </p>
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}
