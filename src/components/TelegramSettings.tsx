"use client";

// Alerts on Telegram: connect (a one-time link that opens the bot; tapping "Start" links the chat),
// then a test and disconnect. Offered only when this server has a bot.
import { useEffect, useState } from "react";
import type { TelegramStatus } from "@/app/api/telegram/route";
import { useI18n } from "@/lib/i18n";
import { toViewResult, type ViewIssue } from "@/lib/resource";
import { useResource } from "@/lib/useResource";
import { IssueNote, Skeleton, StatusMessage, buttonClass } from "./ui";

type Step = { kind: "idle" } | { kind: "linking" } | { kind: "open"; url: string } | { kind: "busy" } | { kind: "note"; text: string; tone?: "warn" } | { kind: "issue"; issue: ViewIssue };

async function call<T>(url: string, method: "POST" | "DELETE", body?: unknown) {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return toViewResult<T>(res.status, await res.json().catch(() => null));
  } catch {
    return { ok: false as const, error: "upstream" as const };
  }
}

export default function TelegramSettings() {
  const { t, lang } = useI18n();
  const T = t.telegram;
  const { state, retry } = useResource<TelegramStatus>("/api/telegram", { shared: false, keepPrevious: true });
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const status = state.status === "ok" ? state.data : state.status === "loading" ? state.previous?.data : undefined;

  // While the user is in Telegram, look for the link every few seconds (for two minutes).
  const waiting = step.kind === "open";
  useEffect(() => {
    if (!waiting) return;
    let n = 0;
    const id = setInterval(() => {
      if (++n > 30) clearInterval(id);
      else retry();
    }, 4000);
    return () => clearInterval(id);
  }, [waiting, retry]);
  useEffect(() => {
    if (status?.linked && step.kind === "open") setStep({ kind: "idle" });
  }, [status?.linked, step.kind]);

  if (state.status === "error") return <IssueNote issue={state.issue} onRetry={retry} />;
  if (!status) return <Skeleton className="h-11 w-56" />;
  if (!status.configured) return <p className="text-sm text-muted">{T.unavailable}</p>;

  const connect = async () => {
    setStep({ kind: "linking" });
    const r = await call<{ url: string }>("/api/telegram", "POST", { lang });
    setStep(r.ok ? { kind: "open", url: r.data.url } : { kind: "issue", issue: r.error });
  };
  const test = async () => {
    setStep({ kind: "busy" });
    const r = await call<{ devices: number; sent: number }>("/api/telegram/test", "POST");
    if (!r.ok) return setStep({ kind: "issue", issue: r.error });
    setStep(r.data.devices === 0 ? { kind: "note", text: T.none, tone: "warn" } : r.data.sent === 0 ? { kind: "note", text: T.failed, tone: "warn" } : { kind: "note", text: T.sent });
    retry();
  };
  const disconnect = async () => {
    setStep({ kind: "busy" });
    const r = await call("/api/telegram", "DELETE");
    setStep(r.ok ? { kind: "idle" } : { kind: "issue", issue: r.error });
    retry();
  };

  return (
    <div className="space-y-3" data-testid="telegram-settings">
      <p className="text-sm text-muted">{T.intro}</p>
      {status.linked ? (
        <>
          <p className="text-sm font-medium" role="status">
            {T.linked}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={test} disabled={step.kind === "busy"} className={buttonClass("secondary", true)}>
              {T.test}
            </button>
            <button type="button" onClick={disconnect} disabled={step.kind === "busy"} className={buttonClass("secondary", true)}>
              {T.disconnect}
            </button>
          </div>
        </>
      ) : step.kind === "open" ? (
        <>
          <a href={step.url} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", true)}>
            {T.openApp}
          </a>
          <p className="text-sm text-muted">{T.waiting}</p>
          <button type="button" onClick={() => (retry(), setStep({ kind: "open", url: step.url }))} className={buttonClass("secondary", true)}>
            {T.check}
          </button>
        </>
      ) : (
        <button type="button" onClick={connect} disabled={step.kind === "linking"} className={buttonClass("primary", true)}>
          {step.kind === "linking" ? T.connecting : T.connect}
        </button>
      )}
      {step.kind === "note" && <StatusMessage tone={step.tone ?? "info"}>{step.text}</StatusMessage>}
      {step.kind === "issue" && <IssueNote issue={step.issue} onRetry={() => setStep({ kind: "idle" })} />}
    </div>
  );
}
