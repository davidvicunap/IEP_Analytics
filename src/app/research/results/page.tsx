import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import TrackRecord from "@/components/research/TrackRecord";
import { Skeleton } from "@/components/ui";
import { DeepI18n } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const en = (await cookies()).get("lang")?.value === "en";
  return { title: en ? "My track record" : "Mis resultados" };
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-4xl rounded-2xl" />}>
      <DeepI18n>
        <TrackRecord />
      </DeepI18n>
    </Suspense>
  );
}
