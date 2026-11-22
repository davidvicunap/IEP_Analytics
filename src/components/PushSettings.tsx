"use client";

// Alerts on this phone or browser: turn on (with the iPhone and blocked-permission cases said
// plainly), send a test, turn off. `variant="prompt"` is the one-line offer shown after a plan is
// saved: it only appears when this device could turn alerts on and hasn't.
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { disablePush, enablePush, readPushStatus, resyncPush, sendTestPush, type PushIssue, type PushStatus } from "@/lib/pushClient";
import { markStep } from "@/lib/onboarding";
import { track } from "@/lib/track";
import TelegramSettings from "./TelegramSettings";
import { IssueNote, Panel, Skeleton, StatusMessage, buttonClass } from "./ui";

type Busy = null | "enable" | "disable" | "test";
type Note = null | { kind: "issue"; issue: PushIssue; retry: () => void } | { kind: "sent"; devices: number; sent: number };

export default function PushSettings({ variant = "panel" }: { variant?: "panel" | "prompt" }) {
  const { t, lang } = useI18n();
  const P = t.push;
  const [status, setStatus] = useState<PushStatus | "checking">("checking");
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<Note>(null);
  const [enabledHere, setEnabledHere] = useState(false);

  useEffect(() => {
    let live = true;
    readPushStatus().then((s) => {
      if (!live) return;
      setStatus(s);
      // The account may have dropped this device (or its language changed): save it again.
      if (s === "on") resyncPush(lang);
    });
    return () => {
      live = false;
    };
  }, [lang]);

  const enable = async () => {
    setBusy("enable");
    setNote(null);
    const r = await enablePush(lang);
    setBusy(null);
    if (r.ok) {
      setStatus("on");
      setEnabledHere(true);
      track("alerts_push_on");
      markStep("alerts");
    } else if (r.issue === "denied") setStatus("denied");
    else if (r.issue !== "dismissed") setNote({ kind: "issue", issue: r.issue, retry: enable });
  };
  const disable = async () => {
    setBusy("disable");
    setNote(null);
    const r = await disablePush();
    setBusy(null);
    if (r.ok) setStatus("off");
    else setNote({ kind: "issue", issue: r.issue, retry: disable });
  };
  const test = async () => {
    setBusy("test");
    setNote(null);
    const r = await sendTestPush();
    setBusy(null);
    setNote(r.ok ? { kind: "sent", devices: r.data.devices, sent: r.data.sent } : { kind: "issue", issue: r.error, retry: test });
  };

  const issueView = (n: Extract<Note, { kind: "issue" }>) =>
    n.issue === "subscribe_failed" || n.issue === "denied" || n.issue === "dismissed" ? (
      <StatusMessage
        tone="warn"
        action={
          <button type="button" onClick={n.retry} className={buttonClass("secondary", true)}>
            {P.retry}
          </button>
        }
      >
        {P.failed}
      </StatusMessage>
    ) : (
      <IssueNote issue={n.issue} onRetry={n.retry} />
    );

  if (variant === "prompt") {
    if (status !== "off" && !(status === "on" && enabledHere)) return null;
    return (
      <div className="space-y-2" data-testid="push-prompt">
        {status === "on" && <StatusMessage>{P.on}</StatusMessage>}
        {status === "off" && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted">{P.prompt}</span>
            <button type="button" onClick={enable} disabled={busy !== null} className={buttonClass("secondary", true)}>
              {busy === "enable" ? P.enabling : P.promptAction}
            </button>
          </div>
        )}
        {note?.kind === "issue" && issueView(note)}
      </div>
    );
  }

  return (
    <Panel title={P.channelsTitle} description={P.intro} id="push">
      <div className="space-y-6">
        <section aria-labelledby="alerts-telegram">
          <h3 id="alerts-telegram" className="mb-2 text-sm font-semibold">
            {t.telegram.title}
          </h3>
          <TelegramSettings />
        </section>
        <section aria-labelledby="alerts-device">
          <h3 id="alerts-device" className="mb-2 text-sm font-semibold">
            {P.deviceTitle}
          </h3>
          <div className="space-y-3" data-testid="push-settings">
            {status === "checking" ? (
              <Skeleton className="h-11 w-64" />
            ) : status === "unsupported" ? (
              <StatusMessage>{P.unsupported}</StatusMessage>
            ) : status === "ios" ? (
              <StatusMessage>{P.ios}</StatusMessage>
            ) : status === "denied" ? (
              <StatusMessage tone="warn">{P.denied}</StatusMessage>
            ) : status === "off" ? (
              <button type="button" onClick={enable} disabled={busy !== null} className={buttonClass("primary", true)}>
                {busy === "enable" ? P.enabling : P.enable}
              </button>
            ) : (
              <>
                <p className="text-sm font-medium" role="status">
                  {P.on}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={test} disabled={busy !== null} className={buttonClass("secondary", true)}>
                    {busy === "test" ? P.testing : P.test}
                  </button>
                  <button type="button" onClick={disable} disabled={busy !== null} className={buttonClass("secondary", true)}>
                    {P.off}
                  </button>
                </div>
              </>
            )}
            {note?.kind === "sent" && <StatusMessage tone={note.sent > 0 ? "info" : "warn"}>{note.devices === 0 ? P.testNone : note.sent === 0 ? P.testFailed : P.testSent}</StatusMessage>}
            {note?.kind === "issue" && issueView(note)}
            <p className="text-xs text-muted">{P.when}</p>
          </div>
        </section>
      </div>
    </Panel>
  );
}
