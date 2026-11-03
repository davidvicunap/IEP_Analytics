import { getQuotes } from "@/lib/data";
import HomeView from "@/components/HomeView";

const INDEXES = ["SPY", "QQQ", "DIA", "IWM"];
const POPULAR = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM"];

export const revalidate = 60;

export default async function Home() {
  const quotes = await getQuotes([...INDEXES, ...POPULAR]);
  const indexes = quotes.filter((q) => INDEXES.includes(q.symbol));
  const popular = quotes.filter((q) => POPULAR.includes(q.symbol));
  return <HomeView indexes={indexes} popular={popular} />;
}
