import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import PackView from "@/components/charts/PackView";
import { Skeleton } from "@/components/ui";
import { DeepI18n } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const en = (await cookies()).get("lang")?.value === "en";
  return { title: en ? "Chart packs" : "Paquetes de gráficos" };
}

export default function PacksPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-xl" />}>
      <DeepI18n>
        <PackView />
      </DeepI18n>
    </Suspense>
  );
}
