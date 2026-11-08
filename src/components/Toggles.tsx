"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { MoonIcon, SunIcon } from "./icons";

const btn = "grid place-items-center h-11 min-w-11 px-2 rounded-lg border border-line bg-panel hover:bg-panel-2 text-sm font-semibold";

export function LangToggle() {
  const { lang, setLang, t } = useI18n();
  const next = lang === "es" ? "en" : "es";
  return (
    // The accessible name starts with the visible text (WCAG 2.5.3 "label in name").
    <button type="button" className={btn} onClick={() => setLang(next)} aria-label={`${lang.toUpperCase()}, ${t.app.switchLang}`}>
      {lang.toUpperCase()}
    </button>
  );
}

type Theme = "dark" | "light";

export function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const attr = document.documentElement.dataset.theme;
    setTheme(attr === "light" || attr === "dark" ? attr : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("iep.theme", next);
    } catch {}
    setTheme(next);
    window.dispatchEvent(new Event("iep-theme"));
  };

  const label = `${t.app.theme}: ${theme === "dark" ? t.app.themeLight : t.app.themeDark}`;
  return (
    <button type="button" className={btn} onClick={toggle} aria-label={label} title={label}>
      {theme === "light" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
