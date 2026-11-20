import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import CompareView from "@/components/compare/CompareView";
import { Skeleton } from "@/components/ui";
import { DeepI18n } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const en = (await cookies()).get("lang")?.value === "en";
  return { title: en ? "Compare" : "Comparar" };
}

export default function ComparePage() {
  return (
    <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-xl" />}>
      <DeepI18n>
        <CompareView />
      </DeepI18n>
    </Suspense>
  );
}
