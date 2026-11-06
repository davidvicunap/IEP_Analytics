import { dataSource, getQuotes } from "@/lib/data";
import HomeView from "@/components/HomeView";

const INDEXES = ["SPY", "QQQ", "DIA", "IWM"];
const POPULAR = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM"];

export default async function Home() {
  const entries = await getQuotes([...INDEXES, ...POPULAR]);
  return (
    <HomeView
      indexes={entries.filter((e) => INDEXES.includes(e.symbol))}
      popular={entries.filter((e) => POPULAR.includes(e.symbol))}
      source={dataSource()}
    />
  );
}
