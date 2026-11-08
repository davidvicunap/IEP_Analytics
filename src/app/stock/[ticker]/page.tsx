import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getQuote, getStockSections, normalizeSymbol } from "@/lib/data";
import StockView from "@/components/StockView";
import DataUnavailable from "@/components/DataUnavailable";

type Props = { params: Promise<{ ticker: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const symbol = normalizeSymbol((await params).ticker);
  return { title: symbol ?? "—" };
}

export default async function StockPage({ params }: Props) {
  const symbol = normalizeSymbol((await params).ticker);
  if (!symbol) notFound();

  // The quote is loaded before anything streams, so an unknown ticker gets a real
  // HTTP 404 and a provider failure gets its own message instead of "not found".
  // Keep this above any Suspense/loading boundary: once streaming starts the status is 200.
  const quote = await getQuote(symbol);
  if (!quote.ok && quote.error === "not_found") notFound();
  if (!quote.ok) return <DataUnavailable issue={quote.error} symbol={symbol} />;

  // Everything else starts now and streams in: each section of the page waits only for
  // its own data (see StockView's Suspense boundaries).
  return <StockView quote={quote.data} quoteFetchedAt={quote.fetchedAt} sections={getStockSections(symbol)} />;
}
