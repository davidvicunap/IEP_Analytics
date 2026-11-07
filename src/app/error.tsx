"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useI18n } from "@/lib/i18n";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="max-w-md mx-auto py-12 space-y-4 text-center">
      <h1 className="text-xl font-bold">{t.errors.title}</h1>
      <p className="text-sm text-muted">{t.errors.text}</p>
      {error.digest && <p className="num text-[11px] text-muted">ref: {error.digest}</p>}
      <div className="flex justify-center gap-3 pt-2">
        <button type="button" onClick={reset} className="h-10 px-4 rounded-lg bg-accent text-accent-fg text-sm font-semibold">
          {t.errors.retry}
        </button>
        <Link href="/" className="h-10 px-4 rounded-lg border border-line bg-panel text-sm font-semibold inline-flex items-center">
          {t.errors.home}
        </Link>
      </div>
    </div>
  );
}
