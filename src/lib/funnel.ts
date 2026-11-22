// First-party measurement: a short list of named events (what people do in the app, never amounts
// or tickers they hold) and the funnel the product plan asks about: did people come back, add
// what they own, set an exit, turn alerts on, receive alerts and open them. Pure and tested.

export const EVENT_NAMES = [
  "visit", // once per day per device
  "position_added",
  "import_done",
  "plan_saved", // the guided plan saved a watched thesis
  "alerts_push_on",
  "alerts_telegram_on",
  "alert_sent", // server side, per delivery
  "alert_opened", // a page opened from a notification or a Telegram button
] as const;
export type EventName = (typeof EVENT_NAMES)[number];
export const isEventName = (v: unknown): v is EventName => typeof v === "string" && (EVENT_NAMES as readonly string[]).includes(v);

/** Only small, non-identifying properties are kept (a channel, a count). */
export function cleanProps(raw: unknown): Record<string, string | number | boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 5)) {
    if (!/^[a-z][a-zA-Z]{0,19}$/.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && /^[a-z_]{1,20}$/.test(v)) out[k] = v;
  }
  return out;
}

export interface EventRow {
  owner: string;
  name: EventName;
  at: string;
}

export const FUNNEL_STEPS = ["visit", "position", "exit", "alertsOn", "alertSent", "alertOpened"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface Funnel {
  people: number;
  active7: number;
  active30: number;
  /** How many people reached each step at least once. */
  steps: Record<FunnelStep, number>;
  /** People whose first visit was 14+ days ago, and how many of them came back in days 7–14 after it. */
  week2: { eligible: number; returned: number };
}

const DAY = 86_400_000;

export function funnel(rows: EventRow[], now: Date): Funnel {
  const by = new Map<string, EventRow[]>();
  for (const r of rows) by.set(r.owner, [...(by.get(r.owner) ?? []), r]);
  const t = now.getTime();
  const has = (list: EventRow[], ...names: EventName[]) => list.some((r) => names.includes(r.name));
  const steps: Record<FunnelStep, number> = { visit: 0, position: 0, exit: 0, alertsOn: 0, alertSent: 0, alertOpened: 0 };
  let active7 = 0;
  let active30 = 0;
  const week2 = { eligible: 0, returned: 0 };
  for (const list of by.values()) {
    const times = list.map((r) => Date.parse(r.at)).sort((a, b) => a - b);
    const last = times.at(-1)!;
    if (t - last <= 7 * DAY) active7++;
    if (t - last <= 30 * DAY) active30++;
    if (has(list, "visit")) steps.visit++;
    if (has(list, "position_added", "import_done")) steps.position++;
    if (has(list, "plan_saved")) steps.exit++;
    if (has(list, "alerts_push_on", "alerts_telegram_on")) steps.alertsOn++;
    if (has(list, "alert_sent")) steps.alertSent++;
    if (has(list, "alert_opened")) steps.alertOpened++;
    const visits = list.filter((r) => r.name === "visit").map((r) => Date.parse(r.at)).sort((a, b) => a - b);
    const first = visits[0];
    if (first !== undefined && t - first >= 14 * DAY) {
      week2.eligible++;
      if (visits.some((v) => v - first >= 7 * DAY && v - first < 14 * DAY)) week2.returned++;
    }
  }
  return { people: by.size, active7, active30, steps, week2 };
}
