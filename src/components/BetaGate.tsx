"use client";

import { useId, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { LangToggle, ThemeToggle } from "./Toggles";

type Status = "idle" | "checking" | "invalid" | "closed" | "error";

export default function BetaGate({ next }: { next: string }) {
  const { t } = useI18n();
  const id = useId();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || status === "checking") return;
    setStatus("checking");
    try {
      const res = await fetch("/api/beta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        // Full navigation so the gate re-checks the new cookie on the server.
        window.location.assign(next);
        return;
      }
      setStatus(res.status === 401 ? "invalid" : res.status === 503 ? "closed" : "error");
    } catch {
      setStatus("error");
    }
  };

  const message =
    status === "invalid" ? t.beta.invalid : status === "closed" ? t.beta.closed : status === "error" ? t.beta.error : null;

  return (
    <div className="min-h-dvh flex flex-col px-4">
      <div className="flex justify-end gap-2 pt-4 max-w-md w-full mx-auto">
        <LangToggle />
        <ThemeToggle />
      </div>
      <main className="flex-1 flex items-center justify-center py-10">
        <div className="w-full max-w-md rounded-xl border border-line bg-panel p-6 sm:p-8">
          <div className="flex items-center gap-2 font-bold tracking-tight text-lg">
            <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true">
              <rect width="64" height="64" rx="14" className="fill-panel-2" />
              <path d="M12 44 L26 30 L35 38 L52 18" stroke="var(--accent)" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>
              IEP <span className="text-accent">Analytics</span>
            </span>
          </div>
          <h1 className="mt-6 text-2xl font-bold">{t.beta.title}</h1>
          <p className="mt-2 text-sm text-muted">{t.beta.text}</p>
          <form onSubmit={submit} className="mt-6 space-y-3" noValidate>
            <label htmlFor={`${id}-code`} className="block text-sm font-medium">
              {t.beta.label}
            </label>
            <input
              id={`${id}-code`}
              name="code"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="IEP-XXXX-XXXX-XXXX"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (status !== "checking") setStatus("idle");
              }}
              aria-invalid={status === "invalid"}
              aria-describedby={message ? `${id}-msg` : undefined}
              className="num w-full h-12 rounded-lg border border-line bg-bg px-3 text-base tracking-wider placeholder:text-muted focus:border-accent outline-none"
            />
            {message && (
              <p id={`${id}-msg`} role="alert" className="text-sm text-down">
                {message}
              </p>
            )}
            <button
              type="submit"
              disabled={status === "checking" || !code.trim()}
              className="w-full h-12 rounded-lg bg-accent text-accent-fg font-semibold disabled:opacity-60"
            >
              {status === "checking" ? t.beta.checking : t.beta.submit}
            </button>
          </form>
          <p className="mt-6 text-xs text-muted">{t.beta.noCode}</p>
        </div>
      </main>
      <p className="pb-6 text-center text-xs text-muted">{t.app.disclaimer}</p>
    </div>
  );
}
