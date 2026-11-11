import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStockPage, getStockSections, normalizeSymbol } from "@/lib/data";
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

  // Resolved before anything streams, so an unknown ticker gets a real HTTP 404. Keep this
  // above any Suspense/loading boundary: once streaming starts the status is 200.
  // A company FMP can't price (not in the plan, quota used up) still opens from the SEC
  // list, with a stored price, its last close, or none (see getStockPage).
  const page = await getStockPage(symbol);
  if (page.kind === "not_found") notFound();
  if (page.kind === "unavailable") return <DataUnavailable issue={page.issue} symbol={symbol} />;

  // Everything else starts now and streams in: each section of the page waits only for
  // its own data (see StockView's Suspense boundaries).
  return (
    <StockView
      identity={page.identity}
      quote={page.quote}
      quoteFetchedAt={page.fetchedAt}
      priceIssue={page.priceIssue}
      sections={getStockSections(symbol)}
    />
  );
}
