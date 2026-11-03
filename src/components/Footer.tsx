"use client";

import { useI18n } from "@/lib/i18n";

export default function Footer() {
  const { t } = useI18n();
  return (
    <footer className="border-t border-line text-xs text-muted text-center px-4 py-4 mb-16 md:mb-0">
      <p>{t.app.disclaimer}</p>
      <p className="mt-1">
        Data: <a className="underline" href="https://financialmodelingprep.com" target="_blank" rel="noopener noreferrer">Financial Modeling Prep</a>
      </p>
    </footer>
  );
}
