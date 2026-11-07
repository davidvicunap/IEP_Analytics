"use client";

import { useEffect, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtBig, fmtDate, fmtNum, fmtPrice } from "@/lib/format";
import type { InsiderSummary, Role } from "@/lib/form4";
import type { InsiderRow, InsidersPayload } from "@/lib/insiders";
import type { DataIssue, Result } from "@/lib/types";
import { Explain, IssueNote, Panel } from "./ui";

type Lang = "es" | "en";
const MAX_CONTINUES = 6; // first visits to busy filers take a few passes
const money = (v: number) => (v < 0 ? `−$${fmtBig(-v)}` : `$${fmtBig(v)}`);

export default function InsidersPanel({ symbol }: { symbol: string }) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<Result<InsidersPayload> | null>(null);

  useEffect(() => {
    let alive = true;
    let passes = 0;
    setState(null);
    const load = () =>
      fetch(`/api/sec/insiders/${encodeURIComponent(symbol)}`)
        .then(async (res) => {
          const body = (await res.json().catch(() => null)) as Result<InsidersPayload> | null;
          if (!alive) return;
          setState(body ?? { ok: false, error: "upstream" });
          // Keep reading while filings are pending; each pass downloads the next batch.
          if (body?.ok && body.data.pending > 0 && ++passes < MAX_CONTINUES) setTimeout(load, 1000);
        })
        .catch(() => alive && setState({ ok: false, error: "upstream" }));
    load();
    return () => {
      alive = false;
    };
  }, [symbol]);

  if (state === null) {
    return (
      <Panel title={t.insiders.title}>
        <p role="status" className="text-sm text-muted">{t.insiders.loading}</p>
        <div className="mt-3 grid gap-3 grid-cols-2 lg:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-lg bg-panel-2 animate-pulse" />)}
        </div>
      </Panel>
    );
  }
  if (!state.ok) {
    return (
      <Panel title={t.insiders.title}>
        <IssueNote issue={state.error as DataIssue} />
      </Panel>
    );
  }

  const { summary: s, recent, pending, checkedAt } = state.data;
  const nothing = s.purchases.count + s.sales.count + s.plannedSales.count === 0;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{t.insiders.title}</h2>
        <p className="text-sm">{fill(t.insiders.window, { from: fmtDate(s.from, lang), to: fmtDate(s.to, lang) })}</p>
        {pending > 0 && (
          <p role="status" className="text-xs text-warn">{fill(t.insiders.partial, { n: pending })}</p>
        )}
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <SummaryCard label={t.insiders.cards.purchases} bucket={s.purchases} tone="up" />
        <SummaryCard label={t.insiders.cards.sales} bucket={s.sales} tone="down" />
        <SummaryCard label={t.insiders.cards.planned} bucket={s.plannedSales} tone="muted" />
        <article className="rounded-lg border border-line bg-panel p-3">
          <h3 className="text-xs text-muted">{t.insiders.cards.net}</h3>
          <p className={`num text-xl font-semibold mt-1 ${s.net > 0 ? "text-up" : s.net < 0 ? "text-down" : ""}`}>{money(s.net)}</p>
        </article>
      </div>

      {nothing && (
        <Panel>
          <p className="text-sm">{t.insiders.none}</p>
        </Panel>
      )}
      <Explain>{t.insiders.explain}</Explain>

      {s.people.length > 0 && <PeopleTable people={s.people} />}
      {recent.length > 0 && <LatestTable rows={recent} lang={lang} />}

      <div className="space-y-1 text-[11px] text-muted">
        {s.otherCount > 0 && <p>{fill(t.insiders.other, { n: s.otherCount })}</p>}
        <p>{t.insiders.method}</p>
        <p>
          {t.insiders.source} · {t.data.updated} <time dateTime={checkedAt}>{fmtAsOf(checkedAt, lang)}</time>
        </p>
      </div>
    </div>
  );
}

function SummaryCard({ label, bucket, tone }: { label: string; bucket: InsiderSummary["purchases"]; tone: "up" | "down" | "muted" }) {
  const { t } = useI18n();
  const color = bucket.value === 0 ? "" : tone === "up" ? "text-up" : tone === "down" ? "text-down" : "";
  return (
    <article className="rounded-lg border border-line bg-panel p-3">
      <h3 className="text-xs text-muted">{label}</h3>
      <p className={`num text-xl font-semibold mt-1 ${color}`}>{money(bucket.value)}</p>
      <p className="text-[11px] text-muted">
        {bucket.insiders === 1 ? t.insiders.person : fill(t.insiders.people, { n: bucket.insiders })}
      </p>
    </article>
  );
}

function roleLabel(role: Role, title: string | null, t: ReturnType<typeof useI18n>["t"]) {
  return role === "officer" && title ? title : t.insiders.roles[role];
}

function PeopleTable({ people }: { people: InsiderSummary["people"] }) {
  const { t } = useI18n();
  return (
    <Panel title={t.insiders.whoTitle}>
      <div className="overflow-x-auto -mx-4" tabIndex={0} aria-label={t.insiders.whoTitle}>
        <table className="num text-sm w-full min-w-[34rem]">
          <caption className="sr-only">{t.insiders.whoTitle}</caption>
          <thead>
            <tr className="text-muted text-xs">
              <th scope="col" className="text-left font-normal pl-4 py-1">{t.insiders.cols.name}</th>
              <th scope="col" className="text-left font-normal">{t.insiders.cols.role}</th>
              <th scope="col" className="text-right font-normal">{t.insiders.cols.bought}</th>
              <th scope="col" className="text-right font-normal">{t.insiders.cols.sold}</th>
              <th scope="col" className="text-right font-normal pr-4">{t.insiders.cols.planned}</th>
            </tr>
          </thead>
          <tbody>
            {people.slice(0, 15).map((p) => (
              <tr key={p.name} className="border-t border-line">
                <th scope="row" className="text-left font-sans font-medium pl-4 py-1.5">{p.name}</th>
                <td className="font-sans text-muted text-xs">{roleLabel(p.role, p.title, t)}</td>
                <td className={`text-right ${p.bought ? "text-up" : "text-muted"}`}>{p.bought ? money(p.bought) : "—"}</td>
                <td className={`text-right ${p.sold ? "text-down" : "text-muted"}`}>{p.sold ? money(p.sold) : "—"}</td>
                <td className="text-right pr-4 text-muted">{p.planned ? money(p.planned) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function LatestTable({ rows, lang }: { rows: InsiderRow[]; lang: Lang }) {
  const { t } = useI18n();
  return (
    <Panel title={t.insiders.latestTitle}>
      <div className="overflow-x-auto -mx-4" tabIndex={0} aria-label={t.insiders.latestTitle}>
        <table className="num text-sm w-full min-w-[46rem]">
          <caption className="sr-only">{t.insiders.latestTitle}</caption>
          <thead>
            <tr className="text-muted text-xs">
              <th scope="col" className="text-left font-normal pl-4 py-1">{t.insiders.cols.date}</th>
              <th scope="col" className="text-left font-normal">{t.insiders.cols.name}</th>
              <th scope="col" className="text-left font-normal">{t.insiders.cols.type}</th>
              <th scope="col" className="text-right font-normal">{t.insiders.cols.shares}</th>
              <th scope="col" className="text-right font-normal">{t.insiders.cols.price}</th>
              <th scope="col" className="text-right font-normal">{t.insiders.cols.value}</th>
              <th scope="col" className="text-right font-normal">{t.insiders.cols.after}</th>
              <th scope="col" className="text-right font-normal pr-4">{t.insiders.cols.filing}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const buy = r.code === "P";
              const type = buy ? t.insiders.types.buy : r.planned ? t.insiders.types.plannedSell : t.insiders.types.sell;
              return (
                <tr key={`${r.accn}-${r.seq}`} className="border-t border-line">
                  <td className="pl-4 py-1.5 whitespace-nowrap">{fmtDate(r.date, lang)}</td>
                  <th scope="row" className="text-left font-sans font-medium">
                    {r.ownerName}
                    {r.otherOwners > 0 && <span className="text-muted font-normal"> {fill(t.insiders.andOthers, { n: r.otherOwners })}</span>}
                    <span className="block text-[11px] font-normal text-muted">{roleLabel(r.isOfficer ? "officer" : r.isDirector ? "director" : r.isTenPct ? "tenPct" : "other", r.officerTitle, t)}</span>
                  </th>
                  <td className={`font-sans ${buy ? "text-up" : r.planned ? "text-muted" : "text-down"}`}>{type}</td>
                  <td className="text-right">{fmtNum(r.shares, lang, 0)}</td>
                  <td className="text-right">{r.price !== null ? fmtPrice(r.price, lang) : "—"}</td>
                  <td className="text-right">{r.price !== null ? money(r.shares * r.price) : "—"}</td>
                  <td className="text-right">{r.ownedAfter !== null ? fmtNum(r.ownedAfter, lang, 0) : "—"}</td>
                  <td className="text-right pr-4">
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-info underline whitespace-nowrap">
                      {t.insiders.open}
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
