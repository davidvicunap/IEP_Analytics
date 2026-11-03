"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import TickerSearch from "./TickerSearch";

export default function NotFoundView() {
  const { t } = useI18n();
  return (
    <div className="max-w-md mx-auto text-center py-12 space-y-4">
      <p className="text-5xl" aria-hidden="true">🔍</p>
      <h1 className="text-xl font-bold">{t.stock.notFound}</h1>
      <p className="text-muted text-sm">{t.stock.notFoundText}</p>
      <div className="text-left">
        <TickerSearch large />
      </div>
      <Link href="/" className="inline-block text-accent underline text-sm">
        {t.stock.backHome}
      </Link>
    </div>
  );
}
