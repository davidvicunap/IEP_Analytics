import { describe, expect, it, vi } from "vitest";
import en from "./i18n/en";
import es from "./i18n/es";
import { holdingSignals } from "./holdingAlerts";
import { uncheckedMessage } from "./push";
import { applyInput, emptyNote } from "./research";
import { memoryStore } from "./researchStore";
import { linkUrl, newLinkCode, parseUpdate, telegramMessage } from "./telegram";
import { ensureWebhook, memoryTelegram, sendTelegram, telegramConfig, type TelegramApi } from "./telegramServer";
import { memoryAlerts } from "./thesisAlertStore";
import { checkHoldings, checkThesis } from "./thesesData";
import type { ThesisFacts } from "./thesis";

describe("Telegram: what the bot receives", () => {
  const msg = (text: string, extra: Record<string, unknown> = {}) => ({ message: { chat: { id: 12345, type: "private" }, text, from: { language_code: "es-MX" }, ...extra } });
  it("reads /start with its code, /stop and anything else; ignores groups and non-text", () => {
    expect(parseUpdate(msg("/start abcdef123456"))).toEqual({ chatId: "12345", command: { kind: "start", code: "abcdef123456" }, lang: "es" });
    expect(parseUpdate(msg("/start"))).toMatchObject({ command: { kind: "start", code: null } });
    expect(parseUpdate(msg("/stop"))).toMatchObject({ command: { kind: "stop" } });
    expect(parseUpdate(msg("hola"))).toMatchObject({ command: { kind: "other" } });
    expect(parseUpdate({ message: { chat: { id: 1, type: "group" }, text: "/start x" } })).toBeNull();
    expect(parseUpdate({ message: { chat: { id: 1 } } })).toBeNull();
    expect(parseUpdate(null)).toBeNull();
  });

  it("writes alerts as escaped HTML with a button that opens the page and marks it as from an alert", () => {
    const m = telegramMessage({ title: "AAPL: <1 aviso>", body: "Tocó tu stop & más", url: "/stock/AAPL?tab=research", tag: "x" }, "https://iep.example", "Abrir");
    expect(m.text).toBe("<b>AAPL: &lt;1 aviso&gt;</b>\nTocó tu stop &amp; más");
    expect(m.reply_markup.inline_keyboard[0][0]).toEqual({ text: "Abrir", url: "https://iep.example/stock/AAPL?tab=research&src=alert" });
    expect(linkUrl("iep_bot", "abc")).toBe("https://t.me/iep_bot?start=abc");
    expect(newLinkCode(() => "11111111-2222-3333-4444-555555555555")).toBe("111111112222333344445555");
  });
});

describe("Telegram: linking and sending", () => {
  it("is off without a bot; the webhook secret comes from the token unless set", () => {
    expect(telegramConfig({})).toBeNull();
    const c = telegramConfig({ TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_BOT_USERNAME: "@iep_bot" })!;
    expect(c.username).toBe("iep_bot");
    expect(c.secret).toMatch(/^[0-9a-f]{48}$/);
    expect(telegramConfig({ TELEGRAM_BOT_TOKEN: "1", TELEGRAM_BOT_USERNAME: "b", TELEGRAM_WEBHOOK_SECRET: "s" })!.secret).toBe("s");
  });

  it("a code links once and expires", async () => {
    const store = memoryTelegram();
    const now = new Date("2026-11-21T15:00:00Z");
    const code = await store.createCode("ana", "es", now);
    expect(await store.takeCode(code, now)).toEqual({ owner: "ana", lang: "es" });
    expect(await store.takeCode(code, now)).toBeNull(); // spent
    const late = await store.createCode("ana", "es", now);
    expect(await store.takeCode(late, new Date(now.getTime() + 16 * 60_000))).toBeNull(); // expired
  });

  it("sends in each chat's language; a chat that blocked the bot is unlinked", async () => {
    const store = memoryTelegram();
    const now = new Date();
    await store.link("1", "ana", "es", now);
    await store.link("2", "ana", "en", now);
    const sent: { chat: unknown; text: string }[] = [];
    const api: TelegramApi = async (_m, body) => {
      sent.push({ chat: body.chat_id, text: String(body.text) });
      return { status: body.chat_id === "2" ? 403 : 200 };
    };
    const config = { token: "t", username: "b", secret: "s" };
    const r = await sendTelegram("ana", (t) => [{ title: t.push.msgTestTitle, body: t.push.msgTestBody, url: "/research", tag: "t" }], { store, config, api, site: "https://x" });
    expect(r).toEqual({ devices: 2, sent: 1, failed: 0, gone: 1 });
    expect(sent.find((s) => s.chat === "1")!.text).toContain(es.push.msgTestBody);
    expect(sent.find((s) => s.chat === "2")!.text).toContain(en.push.msgTestBody);
    expect(await store.chats("ana")).toEqual([{ chatId: "1", lang: "es" }]);
  });

  it("registers the webhook once with its secret", async () => {
    const api = vi.fn<TelegramApi>(async () => ({ status: 200 }));
    const config = { token: "t", username: "b", secret: "sec" };
    await ensureWebhook(config, api, "https://iep.example");
    await ensureWebhook(config, api, "https://iep.example");
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith("setWebhook", expect.objectContaining({ url: "https://iep.example/api/telegram/webhook", secret_token: "sec" }));
  });
});

describe("alerts for what you own", () => {
  const facts = (over: Partial<ThesisFacts> = {}): ThesisFacts => ({ nextResults: { date: "2026-11-24" }, report: { accn: "a1", form: "10-Q", filed: "2026-11-20" }, ...over });
  it("results today or tomorrow and a report from the last two days; nothing the thesis already watches", () => {
    expect(holdingSignals(facts({ nextResults: { date: "2026-11-22" } }), "2026-11-21").signals.map((s) => s.key)).toEqual(["holding:results:2026-11-22", "holding:report:a1"]);
    expect(holdingSignals(facts(), "2026-11-21").signals.map((s) => s.key)).toEqual(["holding:report:a1"]); // results in 3 days: not yet
    expect(holdingSignals(facts({ nextResults: { date: "2026-11-21" } }), "2026-11-21", { results: true, report: true }).signals).toEqual([]);
    expect(holdingSignals({ nextResults: null, report: null }, "2026-11-21").unchecked).toEqual(["results", "report"]);
  });

  it("a holding check and a thesis check never clear each other's alerts", async () => {
    const alerts = memoryAlerts();
    const now = new Date("2026-11-21T15:00:00Z");
    const note = applyInput(emptyNote("KO"), "KO", { stop: 50, baseUpdatedAt: null }, new Date("2026-11-01T10:00:00Z"), () => "id");
    const f = async (_s: string, n: { price: boolean; filings: boolean }): Promise<ThesisFacts> => ({ ...(n.price ? { price: { value: 60, changePct: 0, at: now.toISOString() } } : {}), ...(n.filings ? facts({ nextResults: { date: "2026-11-21" } }) : {}) });
    await checkHoldings("ana", ["KO"], new Map([["KO", note]]), alerts, f, now);
    await checkThesis("ana", note, alerts, f, new Date(now.getTime() + 60_000));
    const active = (await alerts.recent("ana", "KO", new Date(0))).filter((a) => a.clearedAt === null).map((a) => a.key);
    expect(active.sort()).toEqual(["holding:report:a1", "holding:results:2026-11-21"]);
  });

  it("after the close, what couldn't be checked is said in one message", () => {
    const [m] = uncheckedMessage([{ symbol: "AAPL", kinds: ["stop", "price"] }, { symbol: "MSFT", kinds: ["report", "results"] }], es);
    expect(m.title).toBe(es.push.msgUncheckedTitle);
    expect(m.body).toContain("AAPL: stop, precio · MSFT: informes, resultados");
    expect(uncheckedMessage([], es)).toEqual([]);
  });
});

describe("a split under a watched thesis", () => {
  it("restates the levels before checking: no false 'hit your stop', and the user is told", async () => {
    const notes = memoryStore();
    const saved = await notes.save("ana", "NVDA", { stop: 900, target: 1500, price: 1000, baseUpdatedAt: null }, new Date("2026-01-05T15:00:00Z"));
    expect(saved.ok).toBe(true);
    const note = (await notes.get("ana", "NVDA"))!;
    const alerts = memoryAlerts();
    const now = new Date("2026-11-21T15:00:00Z");
    const f = async (): Promise<ThesisFacts> => ({ price: { value: 101, changePct: 1, at: now.toISOString() } });
    const view = await checkThesis("ana", note, alerts, f, now, { splits: [{ symbol: "NVDA", ratio: 10, date: "2026-11-20" }], notes });
    expect(view.alerts.map((a) => a.kind)).toEqual(["split"]);
    expect(view.alerts[0].data).toMatchObject({ ratio: 10, adjusted: true });
    expect(await notes.get("ana", "NVDA")).toMatchObject({ stop: 90, target: 150 });
    // Next run: nothing more to adjust, no new alert.
    const again = await checkThesis("ana", (await notes.get("ana", "NVDA"))!, alerts, f, new Date(now.getTime() + 3_600_000), { splits: [{ symbol: "NVDA", ratio: 10, date: "2026-11-20" }], notes });
    expect(again.alerts.map((a) => a.kind)).toEqual(["split"]);
    expect((await alerts.history("ana", "NVDA", 10)).length).toBe(1);
  });

  it("a renamed or delisted ticker raises its own alert", async () => {
    const note = applyInput(emptyNote("FB"), "FB", { reviewBy: "2027-01-01", baseUpdatedAt: null }, new Date("2026-11-01T10:00:00Z"), () => "id");
    const view = await checkThesis("ana", note, memoryAlerts(), async () => ({}), new Date("2026-11-21T15:00:00Z"), { listing: { status: "renamed", to: "META" } });
    expect(view.alerts).toMatchObject([{ kind: "listing", data: { to: "META" } }]);
    expect(view.status).toBe("atRisk");
  });
});
