// Reads a broker's CSV export (trades or current holdings) into trades the app can store. Brokers
// differ in everything: column names (English or Spanish), separators (comma, semicolon, tab),
// decimal commas, day/month or month/day dates, sells as negative quantities, preamble lines.
// Pure and tested; nothing is guessed silently: every skipped or unreadable row is reported.

export type Field = "symbol" | "side" | "date" | "shares" | "price" | "fees" | "amount";
export type DateOrder = "ymd" | "dmy" | "mdy";

export interface CsvTrade {
  symbol: string;
  side: "buy" | "sell";
  date: string;
  shares: number;
  price: number;
  fees: number;
}

export type CsvRow =
  | { line: number; ok: true; trade: CsvTrade }
  /** A row we couldn't read (which field), or one that isn't a trade (a dividend, a deposit). */
  | { line: number; ok: false; reason: "symbol" | "date" | "shares" | "price" | "future" | "notTrade" };

export interface CsvResult {
  /** "holdings": a positions list without dates or sides (each becomes a buy on `holdingsDate`). */
  kind: "trades" | "holdings";
  columns: Partial<Record<Field, string>>;
  /** Required columns we couldn't find (nothing is imported then). */
  missing: Field[];
  dateOrder: DateOrder | null;
  /** True when the dates fit both day/month and month/day: the user should confirm. */
  dateAmbiguous: boolean;
  rows: CsvRow[];
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Most specific names first: "trade date" beats "settlement date", "price" beats "amount".
const SYNONYMS: Record<Field, string[]> = {
  symbol: ["symbol", "ticker", "simbolo", "emisora", "instrumento", "activo", "accion", "security", "stock", "codigo", "valor"],
  side: ["side", "action", "buy sell", "tipo de operacion", "operacion", "tipo", "movimiento", "sentido", "transaction type", "transaction", "type", "trans type"],
  date: ["trade date", "fecha de operacion", "fecha operacion", "fecha de concertacion", "fecha", "date", "date time", "run date", "transaction date", "fecha de ejecucion"],
  shares: ["quantity", "qty", "shares", "cantidad", "titulos", "acciones", "units", "unidades", "no de titulos", "numero de titulos"],
  price: ["price", "t price", "trade price", "precio", "precio unitario", "unit price", "precio promedio", "avg price", "average price", "average cost", "costo promedio", "precio de compra", "cost per share", "costo unitario"],
  fees: ["fees", "fee", "commission", "commissions", "comision", "comisiones", "comm fee", "comm in usd", "fees comm"],
  amount: ["amount", "importe", "monto", "total", "net amount", "proceeds", "valor total"],
};

const BUY = ["buy", "bought", "b", "compra", "c", "purchase", "comprar", "buy to open", "you bought", "reinvest shares", "reinvestment"];
const SELL = ["sell", "sold", "s", "venta", "v", "vender", "sell to close", "you sold"];

/** Splits CSV text into rows of fields (quotes, doubled quotes and the given separator). */
export function splitCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function separator(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const counts = [",", ";", "\t", "|"].map((s) => [s, first.split(s).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][1] > 0 ? counts[0][0] : ",";
}

function matchColumns(header: string[]): Partial<Record<Field, number>> {
  const names = header.map(norm);
  const out: Partial<Record<Field, number>> = {};
  const taken = new Set<number>();
  for (const pass of ["exact", "contains"] as const) {
    for (const field of Object.keys(SYNONYMS) as Field[]) {
      if (out[field] !== undefined) continue;
      for (const syn of SYNONYMS[field]) {
        const i = names.findIndex((n, j) => !taken.has(j) && (pass === "exact" ? n === syn : n.startsWith(`${syn} `) || n.endsWith(` ${syn}`)));
        if (i >= 0) {
          out[field] = i;
          taken.add(i);
          break;
        }
      }
    }
  }
  return out;
}

/**
 * "1,234.56", "1.234,56", "$ 12", "(5.00)", "USD -7" → number; null when it isn't one. With
 * `decimalComma` (semicolon-separated files) a lone comma is always the decimal separator.
 */
export function parseNumber(raw: string, decimalComma = false): number | null {
  const t = raw.trim();
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t) || /^[^\d]*[-−]/.test(t);
  let s = t.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Both: the later one is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const tail = s.length - lastComma - 1;
    const commas = s.split(",").length - 1;
    s = !decimalComma && tail === 3 && (commas > 1 || lastComma > 0) && !/^0,/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, ""); // "1.234.567": dots as thousands
  }
  const n = Number(s);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const pad = (n: number) => String(n).padStart(2, "0");
const valid = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const year4 = (y: number) => (y < 100 ? 2000 + y : y);

/** The numeric parts of a date in a cell, before deciding the order. */
function dateParts(raw: string): { a: number; b: number; c: number; iso: boolean } | { named: string } | null {
  const s = raw.trim().split(/[ T,]+(?=\d{1,2}:\d{2})/)[0].trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return { a: +m[1], b: +m[2], c: +m[3], iso: true };
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { a: +m[1], b: +m[2], c: +m[3], iso: true };
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) return { a: +m[1], b: +m[2], c: year4(+m[3]), iso: false };
  // "2-Jan-2024", "Jan 2, 2024", "2 ene 2024"
  m = norm(s).match(/^(\d{1,2}) ([a-z]{3})[a-z]* (\d{2,4})$/) ?? null;
  if (m) {
    const mi = Math.max(MONTHS.indexOf(m[2]), MESES.indexOf(m[2]));
    return mi >= 0 && valid(year4(+m[3]), mi + 1, +m[1]) ? { named: `${year4(+m[3])}-${pad(mi + 1)}-${pad(+m[1])}` } : null;
  }
  m = norm(s).match(/^([a-z]{3})[a-z]* (\d{1,2}) (\d{4})$/);
  if (m) {
    const mi = Math.max(MONTHS.indexOf(m[1]), MESES.indexOf(m[1]));
    return mi >= 0 && valid(+m[3], mi + 1, +m[2]) ? { named: `${m[3]}-${pad(mi + 1)}-${pad(+m[2])}` } : null;
  }
  return null;
}

function toIso(p: NonNullable<ReturnType<typeof dateParts>>, order: DateOrder): string | null {
  if ("named" in p) return p.named;
  const [y, mo, d] = p.iso || order === "ymd" ? [p.a, p.b, p.c] : order === "dmy" ? [p.c, p.b, p.a] : [p.c, p.a, p.b];
  return valid(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
}

function cleanSymbol(raw: string): string | null {
  const s = raw
    .trim()
    .toUpperCase()
    .replace(/\s*\*+\s*$/, "") // "AAPL *" (Mexican SIC listings)
    .replace(/[:.\s](US|USA|NYSE|NASDAQ|N|O)$/, "")
    .trim();
  return /^[A-Z][A-Z.\-]{0,9}$/.test(s) ? s : null;
}

function sideOf(raw: string): "buy" | "sell" | null {
  const v = norm(raw);
  if (!v) return null;
  if (BUY.includes(v) || BUY.some((b) => b.length > 2 && v.startsWith(b))) return "buy";
  if (SELL.includes(v) || SELL.some((b) => b.length > 2 && v.startsWith(b))) return "sell";
  return null;
}

const SPANISH = /fecha|precio|cantidad|titulos|emisora|operacion|comision|importe|monto/;

/**
 * Reads the export. `today` bounds the dates (nothing after tomorrow); `holdingsDate` is the
 * buy date given to a holdings list (no dates in it); `order` overrides the detected date order.
 */
export function parseBrokerCsv(text: string, today: string, opts: { holdingsDate?: string; order?: DateOrder } = {}): CsvResult {
  const clean = text.replace(/^﻿/, "");
  const sep = separator(clean);
  const table = splitCsv(clean, sep).filter((r) => r.some((c) => c.trim()));
  // The header is the first of the first 15 rows naming a symbol and a quantity.
  let headerAt = -1;
  let cols: Partial<Record<Field, number>> = {};
  for (let i = 0; i < Math.min(table.length, 15); i++) {
    const c = matchColumns(table[i]);
    if (c.symbol !== undefined && c.shares !== undefined) {
      headerAt = i;
      cols = c;
      break;
    }
  }
  const header = headerAt >= 0 ? table[headerAt] : [];
  const columns = Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, header[i as number]])) as Partial<Record<Field, string>>;
  const kind: CsvResult["kind"] = cols.date === undefined && cols.side === undefined ? "holdings" : "trades";
  const missing = (["symbol", "shares"] as Field[]).filter((f) => cols[f] === undefined);
  if (cols.price === undefined && cols.amount === undefined) missing.push("price");
  if (kind === "trades" && cols.date === undefined) missing.push("date");
  if (missing.length) return { kind, columns, missing, dateOrder: null, dateAmbiguous: false, rows: [] };

  const body = table.slice(headerAt + 1).map((cells, i) => ({ cells, line: headerAt + 2 + i }));
  const cell = (cells: string[], f: Field) => (cols[f] === undefined ? "" : (cells[cols[f]!] ?? "").trim());
  const num = (raw: string) => parseNumber(raw, sep === ";");

  // Date order: what the values allow, then the header's language.
  let order: DateOrder | null = null;
  let ambiguous = false;
  if (kind === "trades") {
    const parts = body.map((r) => dateParts(cell(r.cells, "date"))).filter((p): p is { a: number; b: number; c: number; iso: boolean } => !!p && !("named" in p) && !p.iso);
    const dmy = parts.some((p) => p.a > 12);
    const mdy = parts.some((p) => p.b > 12);
    if (!parts.length) order = "ymd";
    else if (dmy && !mdy) order = "dmy";
    else if (mdy && !dmy) order = "mdy";
    else {
      ambiguous = true;
      order = SPANISH.test(norm(header.join(" "))) ? "dmy" : "mdy";
    }
    if (opts.order) order = opts.order;
  }
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  const rows: CsvRow[] = [];
  for (const { cells, line } of body) {
    const rawSide = cell(cells, "side");
    let side = cols.side !== undefined ? sideOf(rawSide) : null;
    if (cols.side !== undefined && !side) {
      rows.push({ line, ok: false, reason: "notTrade" });
      continue;
    }
    const symbol = cleanSymbol(cell(cells, "symbol"));
    if (!symbol) {
      rows.push({ line, ok: false, reason: "symbol" });
      continue;
    }
    const qty = num(cell(cells, "shares"));
    if (qty === null || qty === 0) {
      rows.push({ line, ok: false, reason: "shares" });
      continue;
    }
    side ??= qty < 0 ? "sell" : "buy";
    const shares = Math.abs(qty);
    let price = num(cell(cells, "price"));
    if ((price === null || price === 0) && cols.amount !== undefined) {
      const amount = num(cell(cells, "amount"));
      price = amount !== null ? Math.abs(amount) / shares : null;
    }
    price = price === null ? null : Math.abs(price);
    if (price === null || (price === 0 && side === "buy")) {
      rows.push({ line, ok: false, reason: "price" });
      continue;
    }
    let date: string | null;
    if (kind === "holdings") date = opts.holdingsDate ?? today;
    else {
      const p = dateParts(cell(cells, "date"));
      date = p ? toIso(p, order ?? "ymd") : null;
    }
    if (!date) {
      rows.push({ line, ok: false, reason: "date" });
      continue;
    }
    if (date > tomorrow) {
      rows.push({ line, ok: false, reason: "future" });
      continue;
    }
    const fees = Math.abs(num(cell(cells, "fees")) ?? 0);
    rows.push({ line, ok: true, trade: { symbol, side, date, shares: Math.round(shares * 1e6) / 1e6, price: Math.round(price * 1e4) / 1e4, fees: Math.round(fees * 100) / 100 } });
  }
  return { kind, columns, missing: [], dateOrder: order, dateAmbiguous: ambiguous && !opts.order, rows };
}
