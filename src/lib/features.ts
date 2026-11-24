// What the MVP offers. Everything here is built, tested and still reachable by its URL; a
// feature set to false is only left out of the navigation, the command palette and the
// buttons that lead to it, so the product reads as one tool: research a company, write the
// thesis, work it on a canvas. Flip a flag to bring a feature back.
export const FEATURES = {
  /** /charts: the chart generator. */
  charts: false,
  /** /charts/packs and the stock page's "Charts" button. */
  chartPacks: false,
  /** /compare, the stock page's "Compare" button and "compare a b" in the palette. */
  compare: false,
  /** /calendar. */
  calendar: false,
  /** /research/results: the track record of closed theses. */
  trackRecord: false,
  /** Importing trades from a broker's CSV on the portfolio. */
  portfolioImport: false,
  /** Alerts through Telegram (phone push alerts stay). */
  telegram: false,
} as const;

export type Feature = keyof typeof FEATURES;
export const isOn = (f: Feature): boolean => FEATURES[f];
