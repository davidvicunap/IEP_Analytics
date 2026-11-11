import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import ScreenerView from "@/components/screener/ScreenerView";
import { Skeleton } from "@/components/ui";
import { DeepI18n } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const en = (await cookies()).get("lang")?.value === "en";
  return { title: en ? "Screener" : "Buscador" };
}

export default function ScreenerPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-xl" />}>
      <DeepI18n>
        <ScreenerView />
      </DeepI18n>
    </Suspense>
  );
}
