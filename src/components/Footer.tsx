"use client";

import { useI18n } from "@/lib/i18n";

export default function Footer() {
  const { t } = useI18n();
  return (
    <footer className="border-t border-line text-xs text-muted px-4 py-5 mb-16 md:mb-0">
      <div className="max-w-7xl mx-auto sm:px-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
        <p>{t.app.disclaimer}</p>
        <p>
          {t.app.dataBy} <a className="underline underline-offset-2 hover:text-fg" href="https://financialmodelingprep.com" target="_blank" rel="noopener noreferrer">Financial Modeling Prep</a>
          {" · "}
          <a className="underline underline-offset-2 hover:text-fg" href="https://www.sec.gov/edgar" target="_blank" rel="noopener noreferrer">SEC EDGAR</a>
        </p>
      </div>
    </footer>
  );
}
