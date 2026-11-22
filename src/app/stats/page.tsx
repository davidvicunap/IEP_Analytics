import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import StatsView from "@/components/StatsView";
import { Skeleton } from "@/components/ui";
import { isDemo } from "@/lib/data";
import { eventStore } from "@/lib/eventStore";
import { funnel, type Funnel } from "@/lib/funnel";
import { DeepI18n } from "@/lib/i18n";
import { notebookOwner } from "@/lib/researchServer";

export const metadata: Metadata = { title: "Stats", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Labels in ADMIN_LABELS (comma-separated) can see it; in demo mode, the local user. */
function isAdmin(owner: string): boolean {
  const labels = (process.env.ADMIN_LABELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return labels.includes(owner) || (isDemo() && owner === "local");
}

export default async function StatsPage() {
  const owner = await notebookOwner(await cookies());
  if (!owner || !isAdmin(owner)) notFound();
  const store = eventStore();
  let data: Funnel | null = null;
  if (store) data = funnel(await store.since(new Date(Date.now() - 90 * 86_400_000)), new Date());
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-3xl rounded-2xl" />}>
      <DeepI18n>
        <StatsView data={data} />
      </DeepI18n>
    </Suspense>
  );
}
