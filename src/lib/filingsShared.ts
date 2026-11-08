// Filing types, form groups and SEC links: pure, safe to import from the browser.
export interface Filing {
  accn: string;
  form: string;
  filed: string; // YYYY-MM-DD
  reportDate: string | null; // period the filing covers, when it has one
  primaryDocument: string;
  description: string;
  items: string[]; // 8-K items, e.g. ["2.02", "9.01"]
  inlineXbrl: boolean;
}

export type FormGroup = "annual" | "quarterly" | "current" | "proxy" | "insiders" | "ownership" | "registration" | "other";

const GROUPS: [FormGroup, RegExp][] = [
  ["annual", /^(10-K|10-KT|20-F|40-F)(\/A)?$/],
  ["quarterly", /^10-Q(\/A)?$/],
  ["current", /^(8-K|6-K)(\/A)?$/],
  ["proxy", /^(DEF 14A|DEFA14A|DEFM14A|PRE 14A|PX14A6G|DEF 14C|PRE 14C)$/],
  ["insiders", /^(3|4|5|144)(\/A)?$/],
  ["ownership", /^(SC 13[DG]|SCHEDULE 13[DG])(\/A)?$/],
  ["registration", /^(S-1|S-3|S-3ASR|S-4|S-8|S-8 POS|F-1|F-3|424B\d|FWP)(\/A)?$/],
];

export function formGroup(form: string): FormGroup {
  for (const [g, re] of GROUPS) if (re.test(form)) return g;
  return "other";
}

const folder = (cik: number, accn: string) => `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}`;
export const filingIndexUrl = (cik: number, accn: string) => `${folder(cik, accn)}/${accn}-index.htm`;
/** The main document. XSL-rendered paths (Form 4) are kept: they are the readable version. */
export const filingDocUrl = (cik: number, f: Pick<Filing, "accn" | "primaryDocument">) =>
  f.primaryDocument ? `${folder(cik, f.accn)}/${f.primaryDocument}` : filingIndexUrl(cik, f.accn);
/** SEC's interactive viewer: every tagged number in the document can be inspected. */
export const xbrlViewerUrl = (cik: number, f: Pick<Filing, "accn" | "primaryDocument">) =>
  `https://www.sec.gov/ix?doc=/Archives/edgar/data/${cik}/${f.accn.replace(/-/g, "")}/${f.primaryDocument}`;

export interface FilingsPayload {
  symbol: string;
  cik: number;
  name: string;
  filings: Filing[];
  older: { available: boolean; loaded: boolean; from: string | null };
}

