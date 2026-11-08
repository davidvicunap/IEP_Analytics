"use client";

import { createContext, use, useCallback, useContext, useMemo, useState } from "react";
import type { Lang } from "../format";
import type { CoreDict, Dict } from "./es";
import type { DeepDict } from "./esDeep";

// Text ships in two parts per language:
// - core (shell, home, watchlist, stock overview): passed in by the server layout, so only
//   the active language reaches the browser;
// - deep (the stock page's secondary tabs): loaded with those tabs, under <DeepI18n>.
const coreLoaders: Record<Lang, () => Promise<CoreDict>> = {
  es: () => import("./es").then((m) => m.default),
  en: () => import("./en").then((m) => m.default),
};
const deepLoaders: Record<Lang, () => Promise<DeepDict>> = {
  es: () => import("./esDeep").then((m) => m.default),
  en: () => import("./enDeep").then((m) => m.default),
};
const deepCache = new Map<Lang, Promise<DeepDict>>();
/** Stable promise per language (required by `use`). */
export function loadDeep(lang: Lang): Promise<DeepDict> {
  let p = deepCache.get(lang);
  if (!p) {
    p = deepLoaders[lang]();
    deepCache.set(lang, p);
  }
  return p;
}

interface Ctx {
  lang: Lang;
  /** Deep sections are only present inside <DeepI18n>. */
  t: Dict;
  setLang: (l: Lang) => void;
}

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ initialLang, dict, children }: { initialLang: Lang; dict: CoreDict; children: React.ReactNode }) {
  const [state, setState] = useState<{ lang: Lang; t: CoreDict }>({ lang: initialLang, t: dict });
  const setLang = useCallback((l: Lang) => {
    document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`;
    // Load the new language's deep text too, so open tabs switch without a gap.
    Promise.all([coreLoaders[l](), loadDeep(l)]).then(([t]) => {
      setState({ lang: l, t });
      document.documentElement.lang = l;
    });
  }, []);
  const value = useMemo(() => ({ lang: state.lang, t: state.t as Dict, setLang }), [state, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Makes the deep sections available to its children (suspends until they're loaded). */
export function DeepI18n({ children }: { children: React.ReactNode }) {
  const ctx = useI18n();
  const deep = use(loadDeep(ctx.lang));
  const value = useMemo(() => ({ ...ctx, t: { ...ctx.t, ...deep } as Dict }), [ctx, deep]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

/** Replace {v} style placeholders. */
export function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
