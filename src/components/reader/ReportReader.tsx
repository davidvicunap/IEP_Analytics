"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtDate, fmtNum } from "@/lib/format";
import { chunks, SECTION_KEYS, wordCount, type Block, type RiskDiff, type SectionKey } from "@/lib/filingReader";
import type { ReaderPayload } from "@/lib/filingReaderShared";
import { filingDocUrl } from "@/lib/filingsShared";
import { useResource } from "@/lib/useResource";
import { ChevronRightIcon, ExternalIcon } from "../icons";
import { Badge, IssueNote, Panel, Segmented, Skeleton, StatusMessage } from "../ui";

type Lang = "es" | "en";
const NUMERIC = /^[\s$€£()%,.\d\-–—]+$/;

/** Reads a 10-K's Business, Risk factors and MD&A in the app; section and filing live in the URL. */
export default function ReportReader({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const R = t.reader;
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const s = params.get("s");
  const section: SectionKey = (SECTION_KEYS as readonly string[]).includes(s ?? "") ? (s as SectionKey) : "business";
  const accn = params.get("accn");
  const go = (next: { s?: SectionKey; accn?: string }) => {
    const q = new URLSearchParams(params.toString());
    if (next.s) q.set("s", next.s);
    if (next.accn) q.set("accn", next.accn);
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  };

  const url = `/api/sec/report/${encodeURIComponent(symbol)}?s=${section}${accn ? `&accn=${encodeURIComponent(accn)}` : ""}`;
  const { state, retry } = useResource<ReaderPayload>(url, { keepPrevious: true });
  const data = state.status === "ok" ? state.data : state.status === "loading" ? state.previous?.data ?? null : null;
  const busy = state.status === "loading";

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href={`/stock/${encodeURIComponent(symbol)}?tab=filings`} className="link inline-flex min-h-11 items-center gap-1 text-sm">
        <ChevronRightIcon size={16} className="rotate-180" />
        {fill(R.back, { s: symbol })}
      </Link>
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{R.title}</p>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{fill(R.heading, { n: data?.name || symbol })}</h1>
        {data && (
          <p className="text-sm text-muted">
            {data.filing.reportDate && <>{fill(R.fiscal, { d: fmtDate(data.filing.reportDate, lang) })} · </>}
            {fill(R.filed, { d: fmtDate(data.filing.filed, lang) })}
          </p>
        )}
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <Segmented label={R.sectionsLabel} value={section} onChange={(v) => go({ s: v })} options={SECTION_KEYS.map((k) => ({ value: k, label: R.sections[k] }))} />
        {data && data.reports.length > 1 && <YearSelect data={data} onChange={(a) => go({ accn: a })} lang={lang} />}
        {data && (
          <a href={filingDocUrl(data.cik, data.filing)} target="_blank" rel="noopener noreferrer" className="link ml-auto inline-flex min-h-11 items-center gap-1 text-sm">
            {R.original}
            <ExternalIcon size={14} />
          </a>
        )}
      </div>
      <p className="text-sm text-muted">{R.sectionHelp[section]}</p>

      {state.status === "error" ? (
        <Panel>
          <IssueNote issue={state.issue} onRetry={retry} />
        </Panel>
      ) : !data || (busy && data.section !== section) ? (
        <Panel>
          <p role="status" className="mb-3 text-sm text-muted">{R.loading}</p>
          <div className="space-y-3" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className={`h-4 ${i % 3 === 2 ? "w-2/3" : "w-full"}`} />
            ))}
          </div>
        </Panel>
      ) : (
        <div className={busy ? "opacity-60 transition-opacity" : ""} aria-busy={busy}>
          <SectionView data={data} lang={lang} />
        </div>
      )}
    </div>
  );
}

function YearSelect({ data, onChange, lang }: { data: ReaderPayload; onChange: (accn: string) => void; lang: Lang }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="control-label mb-1 block">
        {t.reader.year}
      </label>
      <select id={id} value={data.filing.accn} onChange={(e) => onChange(e.target.value)} className="h-11 sm:h-9 rounded-lg border border-line bg-panel px-3 text-sm">
        {data.reports.map((r) => (
          <option key={r.accn} value={r.accn}>
            {fill(t.reader.yearOption, { d: fmtDate(r.filed, lang) })}
          </option>
        ))}
      </select>
    </div>
  );
}

function SectionView({ data, lang }: { data: ReaderPayload; lang: Lang }) {
  const { t } = useI18n();
  const R = t.reader;
  const [onlyChanged, setOnlyChanged] = useState(false);
  const content = data.content;
  const words = useMemo(() => (content ? wordCount(content.blocks) : 0), [content]);
  const parts = useMemo(() => (content ? chunks(content.blocks) : []), [content]);
  if (!content) {
    return (
      <Panel>
        <StatusMessage tone="warn">{R.notFound}</StatusMessage>
      </Panel>
    );
  }
  const titles = parts.filter((c) => c.title).map((c) => c.title!);
  const showOnlyChanged = onlyChanged && !!data.risks;
  const visible = showOnlyChanged ? parts.filter((c) => c.title?.mark) : parts;

  return (
    <div className="space-y-4">
      {data.section === "risks" && <RiskChanges data={data} lang={lang} onlyChanged={onlyChanged} onOnlyChanged={setOnlyChanged} />}
      <Panel>
        <p className="mb-3 text-xs text-muted num">{fill(R.words, { n: fmtNum(words, lang, 0), m: Math.max(1, Math.round(words / 230)) })}</p>
        {titles.length >= 3 && (
          <details className="mb-4 rounded-lg border border-line px-3 py-1">
            <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-medium">{fill(R.contents, { n: titles.length })}</summary>
            <ol className="mb-2 space-y-1 text-sm">
              {titles.map((ti) => (
                <li key={ti.i}>
                  <a href={`#b-${ti.i}`} className="link inline-flex min-h-8 items-baseline gap-2">
                    {ti.t.length > 140 ? `${ti.t.slice(0, 140)}…` : ti.t}
                    {ti.mark && <Badge tone={ti.mark === "new" ? "info" : "warn"}>{R.marks[ti.mark]}</Badge>}
                  </a>
                </li>
              ))}
            </ol>
          </details>
        )}
        <article className="max-w-[72ch] text-[15px] leading-7">
          {visible.map((c, k) => (
            <section key={c.title?.i ?? `lead-${k}`}>
              {c.title && <Title b={c.title} id={`b-${c.title.i}`} />}
              {c.body.map(({ b, i }) => (
                <BlockView key={i} b={b} />
              ))}
            </section>
          ))}
        </article>
        {content.truncated && (
          <StatusMessage tone="info" className="mt-4">
            {fill(R.truncated, { n: fmtNum(words, lang, 0) })}{" "}
            <a href={filingDocUrl(data.cik, data.filing)} target="_blank" rel="noopener noreferrer" className="link">
              {R.original}
            </a>
          </StatusMessage>
        )}
      </Panel>
      <p className="text-xs text-muted">{fill(R.source, { d: fmtDate(data.filing.filed, lang) })}</p>
    </div>
  );
}

function Title({ b, id }: { b: Extract<Block, { k: "p" }>; id: string }) {
  const { t } = useI18n();
  return (
    <h3 id={id} className="mt-6 mb-2 scroll-mt-20 text-[15px] font-semibold leading-6 first:mt-0">
      {b.mark && (
        <span className="mr-2 align-middle">
          <Badge tone={b.mark === "new" ? "info" : "warn"}>{t.reader.marks[b.mark]}</Badge>
        </span>
      )}
      {b.t}
    </h3>
  );
}

function BlockView({ b }: { b: Block }) {
  const { t } = useI18n();
  if (b.k === "p") return <p className="mb-3">{b.t}</p>;
  const width = Math.max(...b.rows.map((r) => r.length));
  return (
    <div className="my-4 overflow-x-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label={t.reader.table}>
      <table className="num w-full text-xs leading-5">
        <tbody>
          {b.rows.map((r, i) => {
            // Header rows (years, "Change") have no label cell: they line up from the right.
            const pad = width - r.length;
            const header = pad > 0 && (i < 2 || NUMERIC.test(r[0]));
            return (
              <tr key={i} className={`border-b border-line last:border-0 ${header && i < 2 ? "text-muted" : ""}`}>
                {header && <td colSpan={pad} />}
                {r.map((c, j) => (
                  <td
                    key={j}
                    colSpan={!header && j === r.length - 1 && pad > 0 ? pad + 1 : undefined}
                    className={`px-2 py-1 ${j === 0 && !header ? "text-left font-sans" : "text-right whitespace-nowrap"}`}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RiskChanges({ data, lang, onlyChanged, onOnlyChanged }: { data: ReaderPayload; lang: Lang; onlyChanged: boolean; onOnlyChanged: (v: boolean) => void }) {
  const { t } = useI18n();
  const C = t.reader.changes;
  if (!data.risks) {
    if (!data.risksNote) return null;
    return (
      <Panel title={C.title}>
        <p className="text-sm text-muted">{C[data.risksNote]}</p>
      </Panel>
    );
  }
  const d: RiskDiff = data.risks.diff;
  const nothing = !d.added.length && !d.changed.length && !d.removed.length;
  return (
    <Panel title={C.title} description={fill(C.intro, { d: fmtDate(data.risks.prior.filed, lang) })}>
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone="info" className="!text-xs">{fill(C.added, { n: d.added.length })}</Badge>
        <Badge tone="warn" className="!text-xs">{fill(C.changed, { n: d.changed.length })}</Badge>
        <Badge tone="bad" className="!text-xs">{fill(C.removed, { n: d.removed.length })}</Badge>
        <Badge className="!text-xs">{fill(C.same, { n: d.same })}</Badge>
      </div>
      {nothing ? (
        <p className="mt-3 text-sm">{C.none}</p>
      ) : (
        <div className="mt-3 space-y-2">
          <DiffList title={C.addedTitle} items={d.added.map((x) => ({ now: x }))} open />
          <DiffList title={C.changedTitle} items={d.changed} />
          <DiffList title={C.removedTitle} items={d.removed.map((x) => ({ now: x }))} />
          {(d.added.length > 0 || d.changed.length > 0) && (
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={onlyChanged} onChange={(e) => onOnlyChanged(e.target.checked)} />
              {C.onlyChanged}
            </label>
          )}
        </div>
      )}
      <p className="mt-2 text-xs leading-relaxed text-muted">{C.method}</p>
    </Panel>
  );
}

function DiffList({ title, items, open = false }: { title: string; items: { now: string; before?: string }[]; open?: boolean }) {
  const { t } = useI18n();
  if (!items.length) return null;
  return (
    <details className="rounded-lg border border-line px-3 py-1" open={open}>
      <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-medium">
        {title} ({items.length})
      </summary>
      <ul className="mb-2 space-y-2 text-sm">
        {items.map((x) => (
          <li key={x.now} className="leading-6">
            {x.now}
            {x.before && (
              <span className="mt-0.5 block text-xs text-muted">
                {t.reader.changes.before} {x.before}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
