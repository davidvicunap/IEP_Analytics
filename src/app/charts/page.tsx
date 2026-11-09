import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import ChartBuilder from "@/components/charts/ChartBuilder";
import { Skeleton } from "@/components/ui";
import { DeepI18n } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const en = (await cookies()).get("lang")?.value === "en";
  return { title: en ? "Charts" : "Gráficos" };
}

export default function ChartsPage() {
  return (
    <Suspense fallback={<ChartsSkeleton />}>
      <DeepI18n>
        <ChartBuilder />
      </DeepI18n>
    </Suspense>
  );
}

function ChartsSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-36 w-full rounded-xl" />
      <Skeleton className="h-[460px] w-full rounded-xl" />
    </div>
  );
}
