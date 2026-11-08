import { Suspense } from "react";
import { dataSource, getQuotes } from "@/lib/data";
import HomeView, { MarketsSection, PopularSection } from "@/components/HomeView";
import { QuoteRowsSkeleton } from "@/components/QuoteList";

const INDEXES = ["SPY", "QQQ", "DIA", "IWM"];
const POPULAR = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM"];

// Always rendered per request: otherwise every build tries to prerender it and spends
// 12 FMP calls of the daily quota.
export const dynamic = "force-dynamic";

/**
 * The search and the page shell stream at once; each quote section waits only for its own
 * quotes (independent Suspense boundaries), so a slow provider never blocks the search.
 */
export default function Home() {
  const source = dataSource();
  return (
    <HomeView
      markets={
        <Suspense fallback={<QuoteRowsSkeleton n={INDEXES.length} note source />}>
          <Markets source={source} />
        </Suspense>
      }
      popular={
        <Suspense fallback={<QuoteRowsSkeleton n={POPULAR.length} source />}>
          <Popular source={source} />
        </Suspense>
      }
    />
  );
}

async function Markets({ source }: { source: ReturnType<typeof dataSource> }) {
  return <MarketsSection entries={await getQuotes(INDEXES)} source={source} />;
}

async function Popular({ source }: { source: ReturnType<typeof dataSource> }) {
  return <PopularSection entries={await getQuotes(POPULAR)} source={source} />;
}
