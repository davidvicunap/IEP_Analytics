// The command palette's brain: what a typed line means. Pure and instant: the words for pages,
// stock sections, actions and settings are matched here in both languages (accents optional);
// only company names go to the search (the SEC list, no FMP quota). "aapl valoración",
// "dcf msft", "seguir ko", "oscuro" and, on a stock page, just "insiders" all work.
import { TICKER } from "./search";

export const SECTIONS = {
  overview: { words: ["resumen", "overview", "precio", "price"], path: "" },
  business: { words: ["negocio", "business"], path: "?tab=business" },
  statements: { words: ["estados", "statements", "financials", "finanzas", "cuentas", "balance", "income"], path: "?tab=business&view=statements" },
  valuation: { words: ["valoracion", "valuation"], path: "?tab=valuation" },
  comps: { words: ["comparables", "comps", "peers", "pares"], path: "?tab=valuation&view=comps" },
  history: { words: ["historia", "history", "multiplos", "multiples"], path: "?tab=valuation&view=history" },
  dcf: { words: ["dcf", "descontado", "discounted"], path: "?tab=valuation&view=dcf" },
  expectations: { words: ["expectativas", "expectations", "implied", "implicito"], path: "?tab=valuation&view=expectations" },
  filings: { words: ["filings", "presentaciones", "sec"], path: "?tab=filings" },
  insiders: { words: ["insiders", "directivos", "form4"], path: "?tab=filings&view=insiders" },
  news: { words: ["noticias", "news"], path: "?tab=filings&view=news" },
  research: { words: ["analisis", "research", "tesis", "thesis", "notas", "notes"], path: "?tab=research" },
  report: { words: ["10-k", "10k", "informe", "report", "lector", "reader", "leer", "read"], path: "/report" },
  chart: { words: ["grafico", "graficos", "chart", "charts"], path: null },
  packs: { words: ["paquete", "paquetes", "pack", "packs"], path: null },
} as const;
export type SectionId = keyof typeof SECTIONS;

export const PAGES = {
  home: { words: ["inicio", "home", "portada"], href: "/" },
  watchlist: { words: ["lista", "watchlist", "list", "favoritos"], href: "/watchlist" },
  screener: { words: ["buscador", "screener", "filtrar", "filter", "screen"], href: "/screener" },
  charts: { words: ["graficos", "charts", "generador", "generator"], href: "/charts" },
  packs: { words: ["paquetes", "packs"], href: "/charts/packs" },
  research: { words: ["analisis", "research", "tesis", "theses", "cuaderno", "notebook"], href: "/research" },
  methodology: { words: ["metodologia", "methodology", "como", "how", "calculamos"], href: "/methodology" },
  compare: { words: ["comparar", "compare", "comparador", "comparison"], href: "/compare" },
  calendar: { words: ["calendario", "calendar", "agenda", "fechas", "dates"], href: "/calendar" },
  results: { words: ["resultados", "results", "historial", "record", "operaciones", "trades", "aciertos"], href: "/research/results" },
} as const;
export type PageId = keyof typeof PAGES;

export const SETTINGS = {
  dark: { words: ["oscuro", "dark", "noche", "night", "tema", "theme"] },
  light: { words: ["claro", "light", "dia", "day", "tema", "theme"] },
  es: { words: ["espanol", "spanish", "es", "idioma", "language"] },
  en: { words: ["ingles", "english", "en", "idioma", "language"] },
} as const;
export type SettingId = keyof typeof SETTINGS;

const ACTIONS = {
  follow: ["seguir", "follow", "anadir", "add", "guardar", "save"],
  unfollow: ["dejar", "unfollow", "quitar", "remove", "eliminar"],
  compare: ["comparar", "compare", "vs", "versus", "contra"],
} as const;
type ActionId = keyof typeof ACTIONS;

export type Command =
  | { type: "stock"; symbol: string; name?: string; section: SectionId }
  | { type: "follow"; symbol: string; name?: string; on: boolean }
  | { type: "compare"; symbols: string[] }
  | { type: "page"; page: PageId }
  | { type: "setting"; setting: SettingId };

export const MAX_ITEMS = 8;

/** Lower case, no accents, single spaces. */
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

/** A typed word matches a keyword when it's the whole keyword, or the start of it (three letters or more). */
const matches = (token: string, word: string) => token === word || (token.length >= 3 && word.startsWith(token));
const anyWord = (token: string, words: readonly string[]) => words.some((w) => matches(token, w));

/** The href a stock command opens. */
export function hrefFor(c: Extract<Command, { type: "stock" }>): string {
  const s = encodeURIComponent(c.symbol);
  if (c.section === "chart") return `/charts?s=${s}`;
  if (c.section === "packs") return `/charts/packs?s=${s}`;
  return `/stock/${s}${SECTIONS[c.section].path}`;
}

export interface Parsed {
  section: SectionId | null;
  action: ActionId | null;
  /** The words left: a ticker or a company name. */
  rest: string;
  /** A lone word read as a section by its start ("dis" → DCF) that could also be a ticker (DIS). */
  alt?: string;
}

const exactly = (tok: string, words: readonly string[]) => words.includes(tok);
/** Little words that join the others ("dejar de seguir", "go to") and name nothing. */
const FILLER = new Set(["de", "del", "la", "el", "los", "las", "al", "of", "the", "to", "ir", "ver", "see", "open", "abrir"]);

/**
 * Splits a line into a section or action keyword and the company part. Whole keywords win over
 * abbreviations, so "dis dcf" is Disney's DCF; one keyword of each kind at most.
 */
export function parse(q: string): Parsed {
  const tokens = normalize(q).split(" ").filter(Boolean);
  // Alone, a little word may be a ticker (DE is Deere): it's filler only beside other words.
  const used = tokens.map((t) => FILLER.has(t) && tokens.some((o) => !FILLER.has(o)));
  let section: SectionId | null = null;
  let action: ActionId | null = null;
  const sectionIds = Object.keys(SECTIONS) as SectionId[];
  const actionIds = Object.keys(ACTIONS) as ActionId[];
  for (const exact of [true, false]) {
    const hit = (tok: string, words: readonly string[]) => (exact ? exactly(tok, words) : anyWord(tok, words));
    tokens.forEach((tok, i) => {
      if (used[i]) return;
      const a = actionIds.find((k) => hit(tok, ACTIONS[k]));
      if (a) {
        action ??= a; // "dejar de seguir": the first action word decides, the second is part of it
        used[i] = true;
      }
    });
    // Actions name no section, so beside one a word is only a section when typed in full:
    // "follow dis" follows Disney rather than opening a DCF.
    if (!exact && action) continue;
    tokens.forEach((tok, i) => {
      if (used[i] || section) return;
      const s = sectionIds.find((k) => hit(tok, SECTIONS[k].words));
      if (s) {
        section = s;
        used[i] = true;
      }
    });
  }
  const rest = tokens.filter((_, i) => !used[i]).join(" ");
  const lone = tokens.length === 1 ? tokens[0] : null;
  const alt = !rest && lone && TICKER.test(lone.toUpperCase()) && lone.length <= 5 && !sectionIds.some((k) => exactly(lone, SECTIONS[k].words)) && !actionIds.some((k) => exactly(lone, ACTIONS[k])) ? lone : undefined;
  return { section, action, rest, alt };
}

export interface Context {
  /** The stock on screen, if any: "dcf" alone then means its DCF. */
  symbol?: string;
  /** Recently viewed and followed stocks, for suggestions with nothing typed. */
  recent: string[];
  following: string[];
  /** Search results for the company part (empty while loading or when there's none). */
  results: { symbol: string; name: string }[];
}

/** The commands for a typed line, best first. */
export function commandsFor(q: string, ctx: Context): Command[] {
  const out: Command[] = [];
  const seen = new Set<string>();
  const push = (c: Command) => {
    const k = JSON.stringify(c.type === "stock" || c.type === "follow" ? { ...c, name: undefined } : c);
    if (!seen.has(k) && out.length < MAX_ITEMS) {
      seen.add(k);
      out.push(c);
    }
  };
  const norm = normalize(q);

  if (!norm) {
    if (ctx.symbol) for (const s of ["valuation", "research", "statements", "insiders"] as const) push({ type: "stock", symbol: ctx.symbol, section: s });
    for (const s of ctx.recent.slice(0, 4)) push({ type: "stock", symbol: s, section: "overview" });
    for (const p of ["watchlist", "screener", "charts", "research"] as const) push({ type: "page", page: p });
    return out;
  }

  const { section, action, rest, alt } = parse(q);
  const tokens = norm.split(" ");

  // Pages and settings whose words cover everything typed. Typed in full ("dark", "lista"), they
  // come before a guessed ticker; abbreviated, after the stocks.
  const covers = (words: readonly string[]) => tokens.every((tok) => anyWord(tok, words));
  const whole = (words: readonly string[]) => tokens.every((tok) => exactly(tok, words));
  const others: { c: Command; exact: boolean }[] = [
    ...(Object.keys(PAGES) as PageId[]).filter((p) => covers(PAGES[p].words)).map((p) => ({ c: { type: "page", page: p } as Command, exact: whole(PAGES[p].words) })),
    ...(Object.keys(SETTINGS) as SettingId[]).filter((k) => covers(SETTINGS[k].words)).map((k) => ({ c: { type: "setting", setting: k } as Command, exact: whole(SETTINGS[k].words) })),
  ];
  const found = ctx.results.some((r) => r.symbol === rest.toUpperCase());
  if (!found) for (const o of others) if (o.exact) push(o.c);

  // "compare aapl msft", "aapl vs msft", or "compare msft" on a stock page: up to four tickers.
  if (action === "compare") {
    const typed = rest
      .split(" ")
      .map((w) => w.toUpperCase())
      .filter((w) => TICKER.test(w));
    const symbols = [...new Set([...(ctx.symbol && !typed.includes(ctx.symbol) ? [ctx.symbol] : []), ...typed])].slice(0, 4);
    if (symbols.length) push({ type: "compare", symbols });
    for (const o of others) push(o.c);
    return out;
  }

  // A company was named: its section (or the overview), or the action on it.
  if (rest) {
    const symbols: { symbol: string; name?: string }[] = [];
    const typed = rest.toUpperCase();
    const known = [...ctx.following, ...ctx.recent];
    // A typed ticker opens at once, unless the search found companies and it isn't one of them ("apple").
    const isTicker = TICKER.test(typed) && !rest.includes(" ") && (ctx.results.length === 0 || found);
    if (isTicker) symbols.push({ symbol: typed, name: ctx.results.find((r) => r.symbol === typed)?.name });
    for (const r of ctx.results) symbols.push(r);
    // Followed and recent stocks first among equals: they're the likely ones.
    symbols.sort((a, b) => (a.symbol === typed ? -1 : b.symbol === typed ? 1 : 0) || +known.includes(b.symbol) - +known.includes(a.symbol));
    for (const s of symbols) {
      if (action) push({ type: "follow", symbol: s.symbol, name: s.name, on: action === "follow" });
      else push({ type: "stock", symbol: s.symbol, name: s.name, section: section ?? "overview" });
    }
  } else if (ctx.symbol && (section || action)) {
    // Nothing but a section or an action: the stock on screen.
    if (action) push({ type: "follow", symbol: ctx.symbol, on: action === "follow" });
    else if (section) push({ type: "stock", symbol: ctx.symbol, section });
  }
  // "dis": Disney too, not only the DCF.
  if (alt) push({ type: "stock", symbol: alt.toUpperCase(), name: ctx.results.find((r) => r.symbol === alt.toUpperCase())?.name, section: "overview" });

  for (const o of others) push(o.c);
  return out;
}
