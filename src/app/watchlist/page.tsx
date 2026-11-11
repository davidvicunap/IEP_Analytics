import type { Metadata } from "next";
import { Suspense } from "react";
import WatchlistView from "@/components/WatchlistView";
import { Skeleton } from "@/components/ui";
import { DeepI18n } from "@/lib/i18n";

export const metadata: Metadata = { title: "Watchlist" };

export default function WatchlistPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[480px] w-full rounded-xl" />}>
      <DeepI18n>
        <WatchlistView />
      </DeepI18n>
    </Suspense>
  );
}
