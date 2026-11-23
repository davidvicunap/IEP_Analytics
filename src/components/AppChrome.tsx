"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { startSync } from "@/lib/prefsSync";
import { trackArrival } from "@/lib/track";
import { useI18n } from "@/lib/i18n";
import Header from "./Header";
import Footer from "./Footer";
import BottomNav from "./BottomNav";
import { Toaster } from "./ui";

/** Header, footer and navigation for the app; the beta gate renders without them. */
export default function AppChrome({ demo, children }: { demo: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const gate = pathname === "/beta" || pathname.startsWith("/beta/");
  // Lists and settings follow the account once signed in (not on the sign-in page itself).
  useEffect(() => {
    if (!gate) {
      startSync();
      trackArrival();
    }
  }, [gate]);
  if (pathname === "/beta" || pathname.startsWith("/beta/")) return <>{children}</>;
  const skip = (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-3 focus:text-accent-fg focus:font-semibold"
    >
      {t.ux.skip}
    </a>
  );
  // A workspace (the Trading Canvas) fills the screen under the header: no footer, no page scroll.
  if (pathname === "/canvas" || pathname.startsWith("/canvas/")) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        {skip}
        <Header demo={demo} />
        <main id="main" tabIndex={-1} className="relative min-h-0 w-full flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom))] outline-none md:pb-0">
          {children}
        </main>
        <BottomNav />
        <Toaster />
      </div>
    );
  }
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
