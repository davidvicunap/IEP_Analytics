// The filing reader's pure parts: a 10-K's HTML turned into readable blocks, the Business,
// Risk factors and MD&A sections found in it, and its risk titles compared with the year
// before. No I/O here (filingReaderData.ts fetches and caches); everything is tested against
// small fixtures and checked by hand on real filings.

export type Block =
  | { k: "p"; t: string; e?: true; mark?: "new" | "changed" } // e: the whole paragraph is bold, italic or underlined (a title)
  | { k: "table"; rows: string[][] };

export const SECTION_KEYS = ["business", "risks", "mdna"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

// ---- HTML → blocks --------------------------------------------------------------------------

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", sbquo: "‚", bdquo: "„", mdash: "—", ndash: "–", minus: "−",
  bull: "•", middot: "·", hellip: "…", reg: "®", trade: "™", copy: "©", sect: "§", para: "¶", deg: "°",
  frac12: "½", frac14: "¼", frac34: "¾", times: "×", divide: "÷", euro: "€", pound: "£", yen: "¥", cent: "¢",
  eacute: "é", egrave: "è", aacute: "á", oacute: "ó", iacute: "í", uacute: "ú", ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä", ccedil: "ç",
  dagger: "†", Dagger: "‡", prime: "′", Prime: "″", zwsp: "", shy: "",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
      if (code === 160 || code === 8199 || code === 8239) return " ";
      if (code === 8203 || code === 173) return "";
      return String.fromCodePoint(code);
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

const BLOCK = new Set(["p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "blockquote", "hr", "center", "dl", "dt", "dd", "pre"]);
const SKIP = new Set(["script", "style", "head", "title", "ix:header", "noscript", "xml"]);
const VOID = new Set(["br", "hr", "img", "meta", "link", "input", "col", "area", "base", "wbr"]);
const CLASSIC_EMPHASIS: Record<string, "b" | "i" | "u"> = { b: "b", strong: "b", i: "i", em: "i", u: "u" };

interface Frame {
  name: string;
  bold: boolean;
  italic: boolean;
  under: boolean;
  hidden: boolean;
}

function styleOf(attrs: string): string {
  const m = /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
  return (m?.[2] ?? m?.[3] ?? "").toLowerCase();
}

/** A paragraph being collected: text runs, each emphasized or not. */
class Para {
  runs: { t: string; e: boolean }[] = [];
  add(t: string, e: boolean) {
    if (t) this.runs.push({ t, e });
  }
  take(): { t: string; e: boolean } | null {
    const t = this.runs.map((r) => r.t).join("").replace(/\s+/g, " ").trim();
    const plain = this.runs.filter((r) => !r.e).map((r) => r.t).join("").replace(/[\s .:;,•·–—-]/g, "");
    this.runs = [];
    return t ? { t, e: plain.length === 0 } : null;
  }
}

/** Cleans a financial table's cells: drops blanks, joins "$" with its number and ")" or "%" with the one before. */
export function cleanRow(cells: string[]): string[] {
  const out: string[] = [];
  for (const raw of cells) {
    const c = raw.replace(/\s+/g, " ").trim();
    if (!c) continue;
    const prev = out.length - 1;
    if (prev >= 0 && /^[$€£]$/.test(out[prev])) out[prev] = `${out[prev]}${c}`;
    else if (prev >= 0 && /^(\)|%|\)%|%\))$/.test(c)) out[prev] = `${out[prev]}${c}`;
    else out.push(c);
  }
  return out;
}

/**
 * Readable blocks from a filing's HTML: paragraphs (with whether they are a bold, italic or
 * underlined title) and tables. Hidden content (the inline-XBRL header), scripts and styles
 * are skipped. Tables used for layout (bullets, a heading split in two cells) become
 * paragraphs; tables of figures stay tables.
 */
export function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const stack: Frame[] = [{ name: "#root", bold: false, italic: false, under: false, hidden: false }];
  let skipping: string | null = null; // inside <script>, <style>, <ix:header>…
  const para = new Para();
  // Tables: only the outermost one is tracked; nested ones are read as text inside its cells.
  let depth = 0;
  let rows: { t: string; e: boolean }[][] = [];
  let cell: Para | null = null;

  const top = () => stack[stack.length - 1];
  const flush = () => {
    const p = para.take();
    if (p) blocks.push(p.e ? { k: "p", t: p.t, e: true } : { k: "p", t: p.t });
  };
  const endCell = () => {
    if (!cell) return;
    const c = cell.take();
    rows[rows.length - 1]?.push(c ?? { t: "", e: false });
    cell = null;
  };
  const endTable = () => {
    endCell();
    const cleaned = rows
      .map((r) => {
        const texts = cleanRow(r.map((c) => c.t));
        const emph = r.filter((c) => c.t.trim()).every((c) => c.e);
        return { texts, emph };
      })
      .filter((r) => r.texts.length > 0);
    rows = [];
    if (!cleaned.length) return;
    const all = cleaned.flatMap((r) => r.texts).join(" ");
    const digits = (all.match(/\d/g) ?? []).length;
    const layout = cleaned.every((r) => r.texts.length <= 2) && digits / Math.max(1, all.length) < 0.12;
    if (layout) {
      for (const r of cleaned) {
        const t = r.texts.join(" ").replace(/\s+/g, " ").trim();
        blocks.push(r.emph ? { k: "p", t, e: true } : { k: "p", t });
      }
    } else {
      blocks.push({ k: "table", rows: cleaned.map((r) => r.texts) });
    }
  };
  const text = (raw: string) => {
    const f = top();
    if (f.hidden || skipping) return;
    const t = decodeEntities(raw);
    if (!t) return;
    const e = f.bold || f.italic || f.under;
    if (depth > 0) {
      if (!cell) {
        if (!rows.length) rows.push([]);
        cell = new Para();
      }
      cell.add(t, e);
    } else para.add(t, e);
  };

  const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!(?:[^>])*>|<\?[^>]*>|<(\/?)([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  for (let m = TAG.exec(html); m; m = TAG.exec(html)) {
    if (m.index > last) text(html.slice(last, m.index));
    last = TAG.lastIndex;
    const name = m[2]?.toLowerCase();
    if (!name) continue; // comment, doctype, processing instruction
    const closing = m[1] === "/";

    if (skipping) {
      if (closing && name === skipping) skipping = null;
      continue;
    }
    if (!closing && SKIP.has(name)) {
      if (!/\/\s*$/.test(m[3])) skipping = name;
      continue;
    }

    if (name === "table") {
      if (closing) {
        if (depth > 0 && --depth === 0) endTable();
      } else {
        if (depth === 0) {
          flush();
          rows = [];
          cell = null;
        }
        depth++;
      }
    } else if (depth === 1 && (name === "tr" || name === "td" || name === "th")) {
      if (!closing && name === "tr") {
        endCell();
        rows.push([]);
      } else if (!closing) {
        endCell();
        if (!rows.length) rows.push([]);
        cell = new Para();
      } else if (name !== "tr") endCell();
    } else if (depth > 0 && (BLOCK.has(name) || name === "tr" || name === "td" || name === "th")) {
      cell?.add(" ", top().bold);
    } else if (depth === 0 && BLOCK.has(name)) {
      flush();
    }

    if (VOID.has(name) || /\/\s*$/.test(m[3])) continue;
    if (closing) {
      // Pop to the matching element; a stray closing tag is ignored.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const parent = top();
    const style = styleOf(m[3]);
    const weight = /font-weight\s*:\s*([a-z0-9]+)/.exec(style)?.[1];
    const fontStyle = /font-style\s*:\s*([a-z]+)/.exec(style)?.[1];
    const deco = /text-decoration(?:-line)?\s*:\s*([a-z\s-]+)/.exec(style)?.[1];
    const classic = CLASSIC_EMPHASIS[name];
    stack.push({
      name,
      bold: weight ? weight === "bold" || weight === "bolder" || Number(weight) >= 600 : classic === "b" || parent.bold,
      italic: fontStyle ? fontStyle === "italic" || fontStyle === "oblique" : classic === "i" || parent.italic,
      under: deco ? deco.includes("underline") : classic === "u" || parent.under,
      hidden: parent.hidden || /display\s*:\s*none/.test(style),
    });
  }
  if (last < html.length) text(html.slice(last));
  if (depth > 0) endTable();
  flush();
  return dropRunningLines(blocks);
}

/** Page headers and footers ("Apple Inc. | 2026 Form 10-K | 19", "Table of Contents"): short lines repeated on many pages. */
export function dropRunningLines(blocks: Block[]): Block[] {
  const key = (t: string) => t.replace(/\d+/g, "#");
  const counts = new Map<string, number>();
  for (const b of blocks) if (b.k === "p" && b.t.length <= 100) counts.set(key(b.t), (counts.get(key(b.t)) ?? 0) + 1);
  return blocks.filter((b) => !(b.k === "p" && b.t.length <= 100 && (counts.get(key(b.t)) ?? 0) >= 4 && !ITEM.test(b.t)));
}

// ---- Sections -------------------------------------------------------------------------------

const ITEM = /^(?:part\s+[iv]+\s*[,.:\-–—]?\s*)?item[\s ]*(\d{1,2}[a-d]?)\b\s*[.:\-–—]?\s*(.*)$/i;
const TARGET: Record<SectionKey, string> = { business: "1", risks: "1a", mdna: "7" };
const TITLES: Record<SectionKey, RegExp> = {
  business: /^business\.?$/i,
  risks: /^risk\s+factors\.?$/i,
  mdna: /^management['’`]?s\s+discussion\s+and\s+analysis\b/i,
};

/** The item number a block announces ("1a" for "Item 1A. Risk Factors"), when it's a short heading line. */
export function itemOf(b: Block): string | null {
  if (b.k !== "p" || b.t.length > 180) return null;
  const m = ITEM.exec(b.t);
  if (!m) return null;
  const rest = m[2];
  // "Item 7 of this report…" inside a sentence is a reference, not a heading.
  if (/^(of|in|to|and|or|for|under|this|above|below|herein)\b/i.test(rest) || /\b(see|refer)\b/i.test(rest.slice(0, 40))) return null;
  return m[1].toLowerCase();
}

const textLength = (blocks: Block[]) => blocks.reduce((n, b) => n + (b.k === "p" ? b.t.length : b.rows.flat().join(" ").length), 0);

export interface Section {
  key: SectionKey;
  blocks: Block[];
  chars: number;
  truncated: boolean;
}

export const SECTION_CHAR_LIMIT = 300_000;
const MIN_SECTION_CHARS = 600;

/**
 * Finds a section by its item heading. The table of contents and cross-references also name
 * the item, so of every place the heading appears, the one followed by the most text before
 * the next item heading is the section itself.
 */
export function findSection(blocks: Block[], key: SectionKey, items: (string | null)[] = blocks.map(itemOf)): Section | null {
  const target = TARGET[key];
  let best: { start: number; end: number; chars: number } | null = null;
  for (let i = 0; i < blocks.length; i++) {
    if (items[i] !== target) continue;
    let end = i + 1;
    while (end < blocks.length && (items[end] === null || items[end] === target)) end++;
    const chars = textLength(blocks.slice(i + 1, end));
    if (!best || chars > best.chars) best = { start: i, end, chars };
  }
  // No usable item heading (some banks lay out their 10-K as an annual report): look for the title itself.
  if (!best || best.chars < MIN_SECTION_CHARS) {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.k !== "p" || b.t.length > 120 || !TITLES[key].test(b.t)) continue;
      let end = i + 1;
      while (end < blocks.length && items[end] === null && !isOtherTitle(blocks[end], key)) end++;
      const chars = textLength(blocks.slice(i + 1, end));
      if (!best || chars > best.chars) best = { start: i, end, chars };
    }
  }
  if (!best || best.chars < MIN_SECTION_CHARS) return null;

  let body = blocks.slice(best.start + 1, best.end);
  // The heading is sometimes split: "Item 1A." then "Risk Factors" on its own line.
  if (body[0]?.k === "p" && body[0].t.length < 80 && TITLES[key].test(body[0].t.replace(/^item\s*\S+\s*/i, ""))) body = body.slice(1);
  body = body.filter((b) => !(b.k === "p" && /^(table of contents|index)$/i.test(b.t)) && !(b.k === "p" && /^\d{1,3}$/.test(b.t)));
  return { key, blocks: body, chars: textLength(body), truncated: false };
}

/** Keeps the first `limit` characters of a section (whole blocks), marking it as cut. */
export function truncateSection(section: Section, limit = SECTION_CHAR_LIMIT): Section {
  let chars = 0;
  for (let i = 0; i < section.blocks.length; i++) {
    chars += textLength([section.blocks[i]]);
    if (chars > limit) return { ...section, blocks: section.blocks.slice(0, i), truncated: true };
  }
  return section;
}

function isOtherTitle(b: Block, key: SectionKey): boolean {
  if (b.k !== "p" || b.t.length > 120) return false;
  return SECTION_KEYS.some((k) => k !== key && TITLES[k].test(b.t));
}

export function findSections(blocks: Block[]): Record<SectionKey, Section | null> {
  const items = blocks.map(itemOf);
  return {
    business: findSection(blocks, "business", items),
    risks: findSection(blocks, "risks", items),
    mdna: findSection(blocks, "mdna", items),
  };
}

// ---- Risk titles and the year-on-year comparison --------------------------------------------

/**
 * The individual risk titles in a Risk factors section: emphasized paragraphs long enough to
 * be a sentence. Short category headings ("Risks Related to Our Business") are left out.
 */
export function riskTitles(section: Section | null): string[] {
  if (!section) return [];
  return section.blocks
    .filter((b): b is Extract<Block, { k: "p" }> => b.k === "p" && !!b.e && b.t.length >= 50 && b.t.length <= 700 && !CATEGORY.test(b.t))
    .map((b) => b.t);
}

const CATEGORY = /^(?:(?:general|other|additional|summary\s+of)\s+)?risks?\s+(?:factors?\s+)?(?:related|relating|associated|regarding|pertaining|concerning|specific|inherent|in connection)\b[^.]{0,110}$/i;

const STOP = new Set(["the", "and", "our", "for", "with", "that", "may", "could", "can", "are", "its", "from", "has", "have", "been", "which", "will", "these", "this", "other", "such", "not", "including", "into", "any", "their", "also", "more"]);

export function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[’‘`]/g, "'")
      .replace(/[^a-z0-9']+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

/**
 * How alike two titles are, 0-1: the average of the share of all their words they have in
 * common and the share of the shorter one's words found in the other (so a title that only
 * gained a clause still counts as the same risk, reworded).
 */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return a.size === b.size ? 1 : 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return (both / (a.size + b.size - both) + both / Math.min(a.size, b.size)) / 2;
}

const norm = (s: string) => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9]+/g, " ").trim();
export const REWORDED = 0.55;

export interface RiskDiff {
  added: string[];
  removed: string[];
  changed: { now: string; before: string }[];
  same: number;
  total: number; // titles this year
  totalBefore: number;
}

/**
 * This year's risk titles against last year's: identical (ignoring punctuation and case),
 * reworded (most of the words in common) or new; last year's left unmatched were removed.
 */
export function compareRisks(now: string[], before: string[]): RiskDiff {
  const used = new Set<number>();
  const beforeNorm = before.map(norm);
  const beforeWords = before.map(words);
  const diff: RiskDiff = { added: [], removed: [], changed: [], same: 0, total: now.length, totalBefore: before.length };
  const pending: number[] = [];
  now.forEach((t, i) => {
    const j = beforeNorm.findIndex((b, k) => !used.has(k) && b === norm(t));
    if (j >= 0) {
      used.add(j);
      diff.same++;
    } else pending.push(i);
  });
  // Best matches first, so a title doesn't take the partner a closer one needs.
  const pairs: { i: number; j: number; s: number }[] = [];
  for (const i of pending) {
    const w = words(now[i]);
    beforeWords.forEach((bw, j) => {
      if (used.has(j)) return;
      const s = similarity(w, bw);
      if (s >= REWORDED) pairs.push({ i, j, s });
    });
  }
  pairs.sort((a, b) => b.s - a.s);
  const matched = new Map<number, number>();
  for (const p of pairs) {
    if (matched.has(p.i) || used.has(p.j)) continue;
    matched.set(p.i, p.j);
    used.add(p.j);
  }
  for (const i of pending) {
    const j = matched.get(i);
    if (j === undefined) diff.added.push(now[i]);
    else diff.changed.push({ now: now[i], before: before[j] });
  }
  diff.removed = before.filter((_, j) => !used.has(j));
  return diff;
}

/** Marks this year's new and reworded titles inside the section, so the reader can flag them. */
export function markRisks(section: Section, diff: RiskDiff): Section {
  const added = new Set(diff.added);
  const changed = new Set(diff.changed.map((c) => c.now));
  return {
    ...section,
    blocks: section.blocks.map((b) => (b.k === "p" && b.e ? (added.has(b.t) ? { ...b, mark: "new" } : changed.has(b.t) ? { ...b, mark: "changed" } : b) : b)),
  };
}

/** Words in a section (for "N words · M min to read"). */
export function wordCount(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) if (b.k === "p") n += b.t.split(/\s+/).filter(Boolean).length;
  return n;
}

/**
 * The section as titled chunks: each emphasized paragraph starts a chunk with the text under
 * it. Text before the first title is a chunk without one. Used to show only changed risks.
 */
export function chunks(blocks: Block[]): { title: (Extract<Block, { k: "p" }> & { i: number }) | null; body: { b: Block; i: number }[] }[] {
  const out: ReturnType<typeof chunks> = [{ title: null, body: [] }];
  blocks.forEach((b, i) => {
    if (b.k === "p" && b.e) out.push({ title: { ...b, i }, body: [] });
    else out[out.length - 1].body.push({ b, i });
  });
  return out.filter((c) => c.title || c.body.length);
}
