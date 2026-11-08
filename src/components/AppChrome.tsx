"use client";

import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import Header from "./Header";
import Footer from "./Footer";
import BottomNav from "./BottomNav";
import { Toaster } from "./ui";

/** Header, footer and navigation for the app; the beta gate renders without them. */
export default function AppChrome({ demo, children }: { demo: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  if (pathname === "/beta" || pathname.startsWith("/beta/")) return <>{children}</>;
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-3 focus:text-accent-fg focus:font-semibold"
      >
        {t.ux.skip}
      </a>
      <Header demo={demo} />
      <main id="main" tabIndex={-1} className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-24 md:pb-10 outline-none min-h-[calc(100dvh-3.5rem)]">
        {children}
      </main>
      <Footer />
      <BottomNav />
      <Toaster />
    </>
  );
}
