"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { fill, useI18n } from "@/lib/i18n";
import { fmtAsOf, fmtBig, fmtNum } from "@/lib/format";
import { shown } from "@/lib/resource";
import {
  DIVISIONS,
  EMPTY_SCREEN,
  MAX_FILTERS,
  PRESETS,
  SCREEN_RATIOS,
  SIZES,
  isPercent,
  parseScreen,
  writeScreen,
  type Division,
  type Screen,
  type ScreenRatio,
  type ScreenRow,
  type ScreenerPayload,
  type Size,
  type SortKey,
} from "@/lib/screener";
import { useResource } from "@/lib/useResource";
import { ChartIcon, CloseIcon } from "../icons";
import { IssueNote, Panel, Segmented, Skeleton, buttonClass } from "../ui";
import { NumberField } from "../valuation/fields";

type Lang = "es" | "en";
const PRESET_KEYS = Object.keys(PRESETS) as (keyof typeof PRESETS)[];

// Ratios that have a chart in the chart generator (growth ones become a growth chart of the base figure).
const CHART_METRIC: Partial<Record<SortKey, string>> = {
  grossMargin: "grossMargin",
  operatingMargin: "operatingMargin",
  netMargin: "netMargin",
  fcfMargin: "fcfMargin",
  roic: "roic",
  roe: "roe",
  debtToEquity: "debtToEquity",
  revenue: "revenue",
  revenueGrowth: "revenue&t=growth",
  epsGrowth: "eps&t=growth",
};

function fmtRatio(k: ScreenRatio, v: number | null, lang: Lang) {
  if (v === null) return "—";
  return isPercent(k) ? `${v < 0 ? "−" : ""}${fmtNum(Math.abs(v) * 100, lang, 1)}%` : `${fmtNum(v, lang, 2)}x`;
}
const titleCase = (s: string | null) => (s ? s.toLowerCase().replace(/(^|[\s&/-])([a-z])/g, (_, p, c) => p + c.toUpperCase()) : "");

interface SavedScreen {
  name: string;
  query: string;
}
const SAVED_KEY = "iep:screens";
function readSaved(): SavedScreen[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x?.name === "string" && typeof x?.query === "string") : [];
  } catch {
    return [];
  }
}
function writeSaved(list: SavedScreen[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: saved screens last for this visit */
  }
}

/** The screener page: filters in the URL, results from /api/sec/screener. */
export default function ScreenerView() {
  const { t, lang } = useI18n();
  const S = t.screener;
  const params = useSearchParams();
  const pathname = usePathname();

  // The screen lives in state (instant) and in the URL (shareable); the request follows the
  // URL after a short pause, so typing a threshold doesn't fire a request per keystroke.
  const [screen, setScreen] = useState<Screen>(() => parseScreen(new URLSearchParams(params.toString())));
  const [query, setQuery] = useState(() => writeScreen(screen));
  useEffect(() => {
    const qs = writeScreen(screen);
    const id = setTimeout(() => {
      setQuery(qs);
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    }, 300);
    return () => clearTimeout(id);
  }, [screen, pathname]);

  const { state, retry } = useResource<ScreenerPayload>(`/api/sec/screener${query ? `?${query}` : ""}`, { keepPrevious: true });
  const data = shown(state)?.data ?? null;
  const updating = state.status === "loading" && data !== null;

  const setBound = (k: ScreenRatio, v: number | null) =>
    setScreen((s) => {
      const bounds = { ...s.bounds };
      if (v === null) delete bounds[k];
      else bounds[k] = v;
      return { ...s, bounds };
    });
  const sortBy = (k: SortKey) =>
    setScreen((s) => ({ ...s, sort: k, dir: s.sort === k ? (s.dir === "asc" ? "desc" : "asc") : k === "rank" || k === "symbol" || k === "debtToEquity" ? "asc" : "desc" }));
  const activePreset = PRESET_KEYS.find((p) => writeScreen({ ...EMPTY_SCREEN, ...PRESETS[p], size: screen.size, division: screen.division, industry: screen.industry }) === writeScreen(screen));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] leading-tight">{S.title}</h1>
        <p className="mt-1 text-[15px] text-muted max-w-2xl">
          {data ? fill(S.intro, { n: fmtNum(data.total, lang, 0), year: data.year }) : S.disclaimer}
        </p>
      </div>

      <section aria-label={S.filters} className="rounded-xl border border-line bg-panel p-4 sm:p-5 space-y-5">
        <div>
          <p className="control-label mb-1.5">{S.presets}</p>
          <div className="flex flex-wrap gap-2">
            {PRESET_KEYS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={activePreset === p}
                onClick={() => setScreen((s) => ({ ...EMPTY_SCREEN, ...PRESETS[p], size: s.size, division: s.division, industry: s.industry }))}
                className={`h-11 sm:h-9 px-3.5 rounded-lg text-[13px] font-medium border ${activePreset === p ? "bg-panel-2 text-fg border-line-strong" : "border-line text-muted hover:text-fg hover:bg-panel-2"}`}
              >
                {S.presetNames[p]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
          <SelectField label={S.sector} value={screen.division ?? ""} onChange={(v) => setScreen((s) => ({ ...s, division: (v || null) as Division | null }))}>
            <option value="">{S.allSectors}</option>
            {DIVISIONS.map((d) => (
              <option key={d} value={d}>
                {S.divisions[d]}
              </option>
            ))}
          </SelectField>
          <TextField label={S.industry} placeholder={S.industryPlaceholder} value={screen.industry} onChange={(v) => setScreen((s) => ({ ...s, industry: v.slice(0, 60) }))} />
          <div>
            <p className="control-label mb-1.5" id="size-label">
              {S.size}
            </p>
            <Segmented label={S.size} value={screen.size} onChange={(v) => setScreen((s) => ({ ...s, size: v as Size }))} options={SIZES.map((z) => ({ value: z, label: S.sizes[z] }))} />
          </div>
        </div>

        <fieldset>
          <legend className="control-label mb-1.5">{S.filters}</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {SCREEN_RATIOS.map((k) => (
              <NumberField
                key={k}
                label={`${S.ratios[k]} (${MAX_FILTERS.has(k) ? S.max : S.min})`}
                value={screen.bounds[k] ?? null}
                onChange={(v) => setBound(k, v)}
                scale={isPercent(k) ? 100 : 1}
                digits={isPercent(k) ? 1 : 2}
                suffix={isPercent(k) ? "%" : "x"}
              />
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setScreen((s) => ({ ...EMPTY_SCREEN, size: s.size }))} className={buttonClass("ghost", true, "text-muted")}>
            <CloseIcon size={14} />
            {S.clear}
          </button>
          <SavedScreens query={writeScreen(screen)} onOpen={(q) => setScreen(parseScreen(new URLSearchParams(q)))} />
        </div>
      </section>

      <Panel
        title={data ? fill(S.results, { m: fmtNum(data.matched, lang, 0), t: fmtNum(data.total, lang, 0) }) : S.title}
        description={data && data.matched > data.rows.length ? S.showing : undefined}
        id="screener-results"
        action={
          data && data.rows.length > 1 ? (
            <Link
              href={`/charts?s=${data.rows.slice(0, 5).map((r) => encodeURIComponent(r.symbol)).join(",")}&m=${CHART_METRIC[screen.sort] ?? "revenue"}&f=annual&k=line&r=10`}
              className={buttonClass("ghost", true, "text-muted")}
            >
              <ChartIcon size={16} />
              <span className="hidden sm:inline">{S.compare}</span>
            </Link>
          ) : undefined
        }
      >
        {state.status === "error" ? (
          <IssueNote issue={state.issue} onRetry={retry} />
        ) : !data ? (
          <>
            <p role="status" className="sr-only">{t.ux.loading}</p>
            <Skeleton className="h-80 w-full rounded-lg" />
          </>
        ) : data.rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">{S.noMatch}</p>
        ) : (
          <div className={`transition-opacity ${updating ? "opacity-60" : ""}`} aria-busy={updating}>
            <Results rows={data.rows} screen={screen} sortBy={sortBy} lang={lang} />
          </div>
        )}
        {data && (
          <div className="mt-4 space-y-1 text-xs text-muted leading-relaxed">
            <p>{fill(S.method, { year: data.year })}</p>
            <p>
              {fill(S.source, { d: fmtAsOf(data.updatedAt, lang) })} · {S.disclaimer}
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Results({ rows, screen, sortBy, lang }: { rows: ScreenRow[]; screen: Screen; sortBy: (k: SortKey) => void; lang: Lang }) {
  const { t } = useI18n();
  const S = t.screener;
  // Columns: the ratios being filtered or sorted on first, then the usual ones, at most 6.
  const cols = useMemo(() => {
    const picked = new Set<ScreenRatio>(SCREEN_RATIOS.filter((k) => screen.bounds[k] !== undefined));
    if ((SCREEN_RATIOS as readonly string[]).includes(screen.sort)) picked.add(screen.sort as ScreenRatio);
    for (const k of ["revenueGrowth", "operatingMargin", "fcfMargin", "roic", "debtToEquity"] as ScreenRatio[]) picked.add(k);
    return [...picked].slice(0, 6);
  }, [screen.bounds, screen.sort]);
  const header = (k: SortKey, label: string, align: "left" | "right" = "right") => {
    const active = screen.sort === k;
    return (
      <th scope="col" aria-sort={active ? (screen.dir === "asc" ? "ascending" : "descending") : "none"} className={`py-2 px-2 font-normal ${align === "left" ? "text-left" : "text-right"}`}>
        <button type="button" onClick={() => sortBy(k)} className={`inline-flex min-h-11 sm:min-h-9 items-center gap-1 whitespace-nowrap hover:text-fg ${active ? "text-fg font-medium" : ""}`} aria-label={fill(S.sortBy, { c: label })}>
          {label}
          {active && <span aria-hidden="true">{screen.dir === "asc" ? "↑" : "↓"}</span>}
        </button>
      </th>
    );
  };
  return (
    <div className="relative -mx-4 overflow-x-auto sm:mx-0" tabIndex={0} role="region" aria-label={S.title}>
      <table className="num w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-xs text-muted border-b border-line">
            {header("symbol", S.cols.company, "left")}
            {header("revenue", S.cols.revenue)}
            {cols.map((k) => (
              <Fragment key={k}>{header(k, S.short[k])}</Fragment>
            ))}
            {header("rank", S.cols.rank)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className="border-b border-line hover:bg-panel-2/60">
              <td className="sticky left-0 bg-panel py-2 pl-4 pr-2 sm:pl-2 max-w-[14rem]">
                <Link href={`/stock/${encodeURIComponent(r.symbol)}`} prefetch={false} className="block hover:underline">
                  <span className="font-semibold">{r.symbol}</span>
                  <span className="block truncate font-sans text-xs text-muted">{titleCase(r.industry) || r.name}</span>
                </Link>
              </td>
              <td className="py-2 px-2 text-right">{r.revenue === null ? "—" : `$${fmtBig(r.revenue)}`}</td>
              {cols.map((k) => (
                <td key={k} className={`py-2 px-2 text-right ${screen.bounds[k] !== undefined ? "font-medium" : ""}`}>
                  {fmtRatio(k, r.ratios[k], lang)}
                </td>
              ))}
              <td className="py-2 px-2 pr-4 sm:pr-2 text-right text-muted">{r.rank ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="control-label mb-1.5 block">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-11 sm:h-9 w-full rounded-lg border border-line bg-panel px-3 text-sm">
        {children}
      </select>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="control-label mb-1.5 block">
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 sm:h-9 w-full rounded-lg border border-line bg-panel px-3 text-sm placeholder:text-muted"
      />
    </div>
  );
}

/** Named screens kept in this browser. */
function SavedScreens({ query, onOpen }: { query: string; onOpen: (q: string) => void }) {
  const { t } = useI18n();
  const S = t.screener;
  const [list, setList] = useState<SavedScreen[]>([]);
  const [name, setName] = useState("");
  const [naming, setNaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => setList(readSaved()), []);
  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);
  const update = (next: SavedScreen[]) => {
    setList(next);
    writeSaved(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {naming ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim().slice(0, 40);
            if (n) update([...list.filter((s) => s.name !== n), { name: n, query }]);
            setName("");
            setNaming(false);
          }}
        >
          <label htmlFor={id} className="sr-only">
            {S.saveName}
          </label>
          <input ref={inputRef} id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={S.saveName} maxLength={40} className="h-11 sm:h-9 w-48 rounded-lg border border-line bg-panel px-3 text-sm placeholder:text-muted" />
          <button type="submit" className={buttonClass("secondary", true)}>
            {S.save}
          </button>
        </form>
      ) : (
        <button type="button" disabled={!query} onClick={() => setNaming(true)} className={buttonClass("ghost", true, "text-muted")}>
          {S.save}
        </button>
      )}
      {list.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label={S.saved}>
          {list.map((s) => (
            <li key={s.name} className="inline-flex items-center rounded-lg bg-panel-2 text-[13px]">
              <button type="button" onClick={() => onOpen(s.query)} className="h-11 sm:h-9 pl-3 pr-1 font-medium">
                {s.name}
              </button>
              <button type="button" onClick={() => update(list.filter((x) => x.name !== s.name))} className="grid h-11 w-10 sm:h-9 sm:w-8 place-items-center text-muted hover:text-fg" aria-label={fill(S.deleteSaved, { n: s.name })}>
                <CloseIcon size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && <span className="text-xs text-muted">{S.savedNote}</span>}
    </div>
  );
}
