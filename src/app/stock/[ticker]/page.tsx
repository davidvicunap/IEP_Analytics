import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStockBundle, normalizeSymbol } from "@/lib/data";
import StockView from "@/components/StockView";

type Props = { params: Promise<{ ticker: string }> };

export const revalidate = 60;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const symbol = normalizeSymbol((await params).ticker);
  return { title: symbol ?? "—" };
}

export default async function StockPage({ params }: Props) {
  const symbol = normalizeSymbol((await params).ticker);
  if (!symbol) notFound();
  const data = await getStockBundle(symbol);
  if (!data) notFound();
  return <StockView data={data} />;
}
