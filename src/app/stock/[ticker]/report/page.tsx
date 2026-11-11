import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import ReportReader from "@/components/reader/ReportReader";
import { Skeleton } from "@/components/ui";
import { normalizeSymbol } from "@/lib/data";
import { DeepI18n } from "@/lib/i18n";

type Props = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const symbol = normalizeSymbol((await params).ticker);
  return { title: symbol ? `${symbol} 10-K` : "10-K" };
}

/** The filing reader: a 10-K's Business, Risk factors and MD&A, with risk changes year on year. */
export default async function ReportPage({ params }: Props) {
  const symbol = normalizeSymbol((await params).ticker);
  if (!symbol) notFound();
  return (
    <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-xl" />}>
      <DeepI18n>
        <ReportReader symbol={symbol} />
      </DeepI18n>
    </Suspense>
  );
}
