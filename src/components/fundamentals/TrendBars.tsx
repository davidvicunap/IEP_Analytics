"use client";

import { useId } from "react";
import { useI18n } from "@/lib/i18n";

/**
 * One bar per fiscal year, negatives below the line. Light enough to show ten of these at
 * once; the figure has a text summary and the numbers sit in a table under it.
 */
export default function TrendBars({
  title,
  headline,
  note,
  labels,
  values,
  format,
  summary,
}: {
  title: string;
  headline: string;
  note?: string;
  labels: string[];
  values: (number | null)[];
  format: (v: number) => string;
  summary: string;
}) {
  const { t } = useI18n();
  const captionId = useId();
  const pos = Math.max(0, ...values.map((v) => v ?? 0));
  const neg = Math.max(0, ...values.map((v) => -(v ?? 0)));
  const span = pos + neg || 1;
  const top = (pos / span) * 100;

  return (
    <article className="rounded-lg border border-line bg-panel p-3 flex flex-col">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="num text-lg font-semibold">{headline}</p>
      {note && <p className="text-[11px] text-muted">{note}</p>}
      <figure aria-labelledby={captionId} className="m-0 mt-2">
        <div className="flex h-28 gap-1" aria-hidden="true">
          {values.map((v, i) => (
            <div key={labels[i]} className="flex flex-1 flex-col" title={v === null ? labels[i] : `${labels[i]}: ${format(v)}`}>
              <div className="flex items-end" style={{ height: `${top}%` }}>
                {v !== null && v > 0 && <div className="w-full rounded-t-sm bg-accent" style={{ height: `${(v / pos) * 100}%`, minHeight: 1 }} />}
              </div>
              <div className="border-t border-line" />
              <div className="flex items-start" style={{ height: `${100 - top}%` }}>
                {v !== null && v < 0 && <div className="w-full rounded-b-sm bg-down" style={{ height: `${(-v / neg) * 100}%`, minHeight: 1 }} />}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1 text-[10px] text-muted" aria-hidden="true">
          {labels.map((l) => (
            <span key={l} className="flex-1 text-center num">
              {l.slice(-2)}
            </span>
          ))}
        </div>
        <figcaption id={captionId} className="sr-only">
          {summary}
        </figcaption>
      </figure>
      <details className="mt-auto pt-2 text-xs">
        <summary className="cursor-pointer select-none text-info min-h-8 inline-flex items-center">{t.trends.table}</summary>
        <table className="num mt-1 w-full">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="text-muted">
              <th scope="col" className="text-left font-normal">{t.trends.year}</th>
              <th scope="col" className="text-right font-normal">{title}</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={l}>
                <td>{l}</td>
                <td className="text-right">{values[i] === null ? "—" : format(values[i]!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </article>
  );
}
