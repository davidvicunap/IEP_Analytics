"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import TickerSearch from "./TickerSearch";
import { SearchIcon } from "./icons";
import { buttonClass } from "./ui";

export default function NotFoundView() {
  const { t } = useI18n();
  return (
    <div className="max-w-md mx-auto text-center py-12 space-y-4">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-panel-2 text-muted" aria-hidden="true">
        <SearchIcon size={28} />
      </span>
      <h1 className="text-xl font-semibold tracking-[-0.015em]">{t.stock.notFound}</h1>
      <p className="text-muted text-sm">{t.stock.notFoundText}</p>
      <div className="text-left">
        <TickerSearch large />
      </div>
      <Link href="/" className={buttonClass("secondary")}>
        {t.stock.backHome}
      </Link>
    </div>
  );
}
