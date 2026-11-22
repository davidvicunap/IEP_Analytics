"use client";

// The admin funnel (/stats): people, activity and each step of the path the product is built on.
import { fill, useI18n } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import { FUNNEL_STEPS, type Funnel } from "@/lib/funnel";
import { EmptyState, Panel, StatusMessage } from "./ui";

export default function StatsView({ data }: { data: Funnel | null }) {
  const { t, lang } = useI18n();
  const S = t.stats;
  const pct = (a: number, b: number) => (b > 0 ? `${fmtNum((a / b) * 100, lang, 0)}%` : "—");
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{S.title}</h1>
        <p className="mt-1 text-[15px] text-muted">{S.intro}</p>
      </div>
      {!data ? (
        <StatusMessage tone="warn">{S.unavailable}</StatusMessage>
      ) : data.people === 0 ? (
        <Panel>
          <EmptyState title={S.title}>{S.none}</EmptyState>
        </Panel>
      ) : (
        <>
          <Panel>
            <dl className="num grid grid-cols-3 gap-4" data-testid="stats-people">
              {(
                [
                  [S.people, data.people],
                  [S.active7, data.active7],
                  [S.active30, data.active30],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="text-2xl font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title={S.funnel} id="funnel">
            <ol className="space-y-3" data-testid="stats-funnel">
              {FUNNEL_STEPS.map((k, i) => {
                const n = data.steps[k];
                const prev = i === 0 ? data.people : data.steps[FUNNEL_STEPS[i - 1]];
                return (
                  <li key={k}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span>{S.steps[k]}</span>
                      <span className="num font-semibold">{n}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-panel-2" aria-hidden="true">
                      <div className="h-2 rounded-full bg-[var(--series-1)]" style={{ width: `${data.people ? (n / data.people) * 100 : 0}%` }} />
                    </div>
                    {i > 0 && <p className="mt-0.5 text-xs text-muted">{fill(S.ofPrev, { p: pct(n, prev) })}</p>}
                  </li>
                );
              })}
            </ol>
          </Panel>
          <Panel title={S.week2} id="week2">
            <p className="num text-2xl font-semibold">{fill(S.week2Value, { r: data.week2.returned, e: data.week2.eligible })}</p>
            <p className="mt-1 text-xs text-muted">{S.week2Note}</p>
          </Panel>
        </>
      )}
    </div>
  );
}
