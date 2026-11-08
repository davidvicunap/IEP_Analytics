// SEC Form 4 (insider transactions) parsing and 12-month summaries. Pure functions.
//
// Rules, so every total can be checked against the filings:
//  - Only non-derivative transactions count (common stock actually bought or sold).
//  - Purchases = code P (open market or private purchase); sales = code S.
//    Grants (A), option exercises (M), tax withholding (F), gifts (G) and other codes are
//    listed as "other" and never counted as buying or selling.
//  - A sale is "planned" when the filing ticks the Rule 10b5-1 box (since 2023) or a footnote
//    on that transaction says it was made under a 10b5-1 trading plan.
//  - Amendments (4/A) are skipped so nothing is counted twice.
import { XMLParser } from "fast-xml-parser";

export interface InsiderTx {
  accn: string;
  seq: number; // position within the filing
  ownerCik: number | null;
  ownerName: string;
  otherOwners: number; // joint filers beyond the first
  isDirector: boolean;
  isOfficer: boolean;
  isTenPct: boolean;
  officerTitle: string | null;
  date: string; // transaction date
  code: string;
  acquired: boolean; // A (acquired) vs D (disposed)
  shares: number;
  price: number | null;
  ownedAfter: number | null;
  direct: boolean;
  planned: boolean;
  security: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false, // numbers and booleans are parsed below, explicitly
  trimValues: true,
  isArray: (name) => ["reportingOwner", "nonDerivativeTransaction", "footnote", "footnoteId"].includes(name),
});

type Node = Record<string, unknown>;
const obj = (v: unknown): Node => (v && typeof v === "object" ? (v as Node) : {});
const text = (v: unknown): string => {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  const n = obj(v);
  return typeof n["#text"] === "string" ? n["#text"].trim() : "";
};
const val = (v: unknown) => text(obj(v).value ?? v);
const bool = (v: unknown) => ["true", "1"].includes(text(v).toLowerCase());
const num = (s: string): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Every footnote id referenced anywhere inside a node. */
function footnoteIds(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => footnoteIds(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Node)) {
      if (k === "footnoteId") for (const f of v as Node[]) out.add(String(obj(f)["@_id"] ?? ""));
      else footnoteIds(v, out);
    }
  }
  return out;
}

const PLAN = /10b5-1/i;
const NOT_PLAN = /not\s+(?:made\s+)?pursuant\s+to\s+(?:a\s+)?(?:rule\s+)?10b5-1/i;

export function parseForm4(xml: string, accn: string): InsiderTx[] {
  const doc = obj(parser.parse(xml).ownershipDocument);
  if (!Object.keys(doc).length) throw new Error("form4: not an ownership document");

  const owners = (doc.reportingOwner as Node[] | undefined) ?? [];
  const first = obj(owners[0]);
  const id = obj(first.reportingOwnerId);
  const rel = obj(first.reportingOwnerRelationship);
  const ownerCik = num(text(id.rptOwnerCik));
  const owner = {
    ownerCik: ownerCik && ownerCik > 0 ? ownerCik : null,
    ownerName: text(id.rptOwnerName) || "—",
    otherOwners: Math.max(0, owners.length - 1),
    isDirector: bool(rel.isDirector),
    isOfficer: bool(rel.isOfficer),
    isTenPct: bool(rel.isTenPercentOwner),
    officerTitle: text(rel.officerTitle) || null,
  };

  const notes = new Map<string, string>();
  for (const f of (obj(doc.footnotes).footnote as Node[] | undefined) ?? []) notes.set(String(f["@_id"] ?? ""), text(f));
  const boxTicked = bool(doc.aff10b5One);

  const rows = (obj(doc.nonDerivativeTable).nonDerivativeTransaction as Node[] | undefined) ?? [];
  return rows.flatMap((t, seq): InsiderTx[] => {
    const coding = obj(t.transactionCoding);
    const amounts = obj(t.transactionAmounts);
    const shares = num(val(amounts.transactionShares));
    const date = val(t.transactionDate).slice(0, 10);
    if (shares === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const referenced = [...footnoteIds(t)].map((i) => notes.get(i) ?? "");
    const planned = boxTicked || referenced.some((n) => PLAN.test(n) && !NOT_PLAN.test(n));
    return [
      {
        accn,
        seq,
        ...owner,
        date,
        code: text(coding.transactionCode).toUpperCase(),
        acquired: val(amounts.transactionAcquiredDisposedCode).toUpperCase() === "A",
        shares,
        price: num(val(amounts.transactionPricePerShare)),
        ownedAfter: num(val(obj(t.postTransactionAmounts).sharesOwnedFollowingTransaction)),
        direct: val(obj(t.ownershipNature).directOrIndirectOwnership).toUpperCase() !== "I",
        planned,
        security: val(t.securityTitle) || "—",
      },
    ];
  });
}

/** Raw XML path from a submissions `primaryDocument` (which points at the XSL-rendered view). */
export function form4XmlUrl(issuerCik: number, accn: string, primaryDocument: string): string {
  const file = primaryDocument.split("/").pop() || primaryDocument;
  return `https://www.sec.gov/Archives/edgar/data/${issuerCik}/${accn.replace(/-/g, "")}/${file}`;
}

// ---- 12-month summary ---------------------------------------------------------------

export type Role = "officer" | "director" | "tenPct" | "other";
export function roleOf(t: Pick<InsiderTx, "isOfficer" | "isDirector" | "isTenPct">): Role {
  return t.isOfficer ? "officer" : t.isDirector ? "director" : t.isTenPct ? "tenPct" : "other";
}

export interface Bucket {
  count: number; // transactions
  insiders: number; // distinct people or entities
  shares: number;
  value: number; // shares × price, where a price is reported
}

export interface InsiderSummary {
  from: string;
  to: string;
  purchases: Bucket;
  sales: Bucket; // discretionary sales
  plannedSales: Bucket; // under a 10b5-1 plan
  net: number; // purchases − all sales, in dollars
  otherCount: number; // grants, exercises, withholding, gifts…
  people: { name: string; role: Role; title: string | null; bought: number; sold: number; planned: number }[];
}

const emptyBucket = (): Bucket => ({ count: 0, insiders: 0, shares: 0, value: 0 });

export function summarize(txs: InsiderTx[], today: string, days = 365): InsiderSummary {
  const from = new Date(Date.parse(today) - days * 86_400_000).toISOString().slice(0, 10);
  const inWindow = txs.filter((t) => t.date >= from && t.date <= today);
  const buckets = { purchases: emptyBucket(), sales: emptyBucket(), plannedSales: emptyBucket() };
  const who = { purchases: new Set<string>(), sales: new Set<string>(), plannedSales: new Set<string>() };
  const people = new Map<string, InsiderSummary["people"][number]>();
  let otherCount = 0;

  for (const t of inWindow) {
    const key = t.code === "P" && t.acquired ? "purchases" : t.code === "S" && !t.acquired ? (t.planned ? "plannedSales" : "sales") : null;
    if (!key) {
      otherCount++;
      continue;
    }
    const value = t.price !== null ? t.shares * t.price : 0;
    const b = buckets[key];
    b.count++;
    b.shares += t.shares;
    b.value += value;
    const id = t.ownerCik ? String(t.ownerCik) : t.ownerName;
    who[key].add(id);
    const p = people.get(id) ?? { name: t.ownerName, role: roleOf(t), title: t.officerTitle, bought: 0, sold: 0, planned: 0 };
    if (key === "purchases") p.bought += value;
    else if (key === "sales") p.sold += value;
    else p.planned += value;
    people.set(id, p);
  }
  for (const k of Object.keys(buckets) as (keyof typeof buckets)[]) buckets[k].insiders = who[k].size;
  return {
    from,
    to: today,
    ...buckets,
    net: buckets.purchases.value - buckets.sales.value - buckets.plannedSales.value,
    otherCount,
    people: [...people.values()].sort((a, b) => b.bought + b.sold + b.planned - (a.bought + a.sold + a.planned)),
  };
}
