"use client";

import { usePathname } from "next/navigation";
import Header from "./Header";
import Footer from "./Footer";
import BottomNav from "./BottomNav";

/** Header, footer and navigation for the app; the beta gate renders without them. */
export default function AppChrome({ demo, children }: { demo: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/beta" || pathname.startsWith("/beta/")) return <>{children}</>;
  return (
    <>
      <Header demo={demo} />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-24 md:pb-10">{children}</main>
      <Footer />
      <BottomNav />
    </>
  );
}
