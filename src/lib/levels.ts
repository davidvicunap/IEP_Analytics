// Support and resistance zones from daily prices. Descriptive, not a forecast: a zone is a price
// area where the stock turned around several times before (swing highs and lows grouped
// together), plus the reference levels many traders watch (52-week range, 50/200-day averages).

export interface Bar {
  time: string;
  high: number;
  low: number;
  close: number;
}

export interface Zone {
  price: number; // centre of the zone
  low: number;
  high: number;
  touches: number; // swing highs/lows inside the zone
  lastDate: string;
  distance: number; // vs the last close, as a fraction (−0.04 = 4 % below)
}

export interface Reference {
  key: "high52" | "low52" | "sma50" | "sma200";
  price: number;
  distance: number;
  date?: string;
}

export interface KeyLevels {
  close: number;
  date: string;
  atr: number | null;
  tolerance: number;
  supports: Zone[]; // nearest first
  resistances: Zone[]; // nearest first
  references: Reference[];
}

export const LOOKBACK = 504; // ~2 years of sessions
export const SWING_WINDOW = 5; // a swing high is the highest high of the 5 sessions on each side
export const MIN_TOUCHES = 2;
export const MAX_EACH = 3;

/** Average true range over the last `n` sessions. */
export function atr(bars: Bar[], n = 14): number | null {
  if (bars.length < n + 1) return null;
  let sum = 0;
  for (let i = bars.length - n; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    sum += Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - prev), Math.abs(bars[i].low - prev));
  }
  return sum / n;
}

function swings(bars: Bar[], w: number): { price: number; date: string }[] {
  const out: { price: number; date: string }[] = [];
  for (let i = w; i < bars.length - w; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - w; j <= i + w && (isHigh || isLow); j++) {
      if (j === i) continue;
      if (bars[j].high > bars[i].high) isHigh = false;
      if (bars[j].low < bars[i].low) isLow = false;
    }
    if (isHigh) out.push({ price: bars[i].high, date: bars[i].time });
    if (isLow) out.push({ price: bars[i].low, date: bars[i].time });
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function keyLevels(all: Bar[]): KeyLevels | null {
  const bars = all.slice(-LOOKBACK);
  if (bars.length < 60) return null;
  const last = bars[bars.length - 1];
  const close = last.close;
  const a = atr(bars);
  const tolerance = Math.max(close * 0.015, (a ?? 0) * 0.6);

  // Group swing points whose prices sit within the tolerance of the running group average.
  const points = swings(bars, SWING_WINDOW).sort((x, y) => x.price - y.price);
  const groups: { price: number; date: string }[][] = [];
  for (const p of points) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(p.price - mean(g.map((x) => x.price))) <= tolerance) g.push(p);
    else groups.push([p]);
  }
  const zones: Zone[] = groups
    .filter((g) => g.length >= MIN_TOUCHES)
    .map((g) => {
      const prices = g.map((x) => x.price);
      const price = mean(prices);
      return {
        price,
        low: Math.min(...prices),
        high: Math.max(...prices),
        touches: g.length,
        lastDate: g.map((x) => x.date).sort().at(-1)!,
        distance: price / close - 1,
      };
    });

  const supports = zones.filter((z) => z.price < close).sort((x, y) => y.price - x.price).slice(0, MAX_EACH);
  const resistances = zones.filter((z) => z.price >= close).sort((x, y) => x.price - y.price).slice(0, MAX_EACH);

  const year = bars.slice(-252);
  const hi = year.reduce((m, b) => (b.high > m.high ? b : m), year[0]);
  const lo = year.reduce((m, b) => (b.low < m.low ? b : m), year[0]);
  const closes = all.map((b) => b.close);
  const sma = (n: number) => (closes.length >= n ? mean(closes.slice(-n)) : null);
  const references: Reference[] = [
    { key: "high52", price: hi.high, date: hi.time, distance: hi.high / close - 1 },
    { key: "low52", price: lo.low, date: lo.time, distance: lo.low / close - 1 },
  ];
  for (const [key, n] of [["sma50", 50], ["sma200", 200]] as const) {
    const v = sma(n);
    if (v !== null) references.push({ key, price: v, distance: v / close - 1 });
  }
  return { close, date: last.time, atr: a, tolerance, supports, resistances, references };
}
