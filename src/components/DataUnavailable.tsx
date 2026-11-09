"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import type { DataIssue } from "@/lib/types";
import { IssueNote, buttonClass } from "./ui";

/** Full-page state when the data provider fails: says why, never "not found". */
export default function DataUnavailable({ issue, symbol }: { issue: DataIssue; symbol?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <div className="max-w-md mx-auto py-12 space-y-4 text-center">
      <h1 className="text-xl font-semibold tracking-[-0.015em]">
        {t.data.unavailableTitle}
        {symbol && <span className="num text-fg"> · {symbol}</span>}
      </h1>
      <IssueNote issue={issue} className="justify-center text-left" />
      <div className="flex justify-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.refresh()}
          className={buttonClass("primary")}
        >
          {t.errors.retry}
        </button>
        <Link href="/" className={buttonClass("secondary")}>
          {t.errors.home}
        </Link>
      </div>
    </div>
  );
}
