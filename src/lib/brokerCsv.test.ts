import { describe, expect, it } from "vitest";
import { parseBrokerCsv, parseNumber, splitCsv } from "./brokerCsv";

const TODAY = "2026-11-21";
const trades = (r: ReturnType<typeof parseBrokerCsv>) => r.rows.flatMap((x) => (x.ok ? [x.trade] : []));
const problems = (r: ReturnType<typeof parseBrokerCsv>) => r.rows.flatMap((x) => (x.ok ? [] : [`${x.line}:${x.reason}`]));

describe("reading numbers and fields", () => {
  it("understands thousands, decimal commas, currency signs and negatives", () => {
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("$ 185.50")).toBe(185.5);
    expect(parseNumber("(5.00)")).toBe(-5);
    expect(parseNumber("USD -7")).toBe(-7);
    expect(parseNumber("0,5")).toBe(0.5);
    expect(parseNumber("12,500")).toBe(12500);
    expect(parseNumber("12,500", true)).toBe(12.5);
    expect(parseNumber("1.234.567")).toBe(1234567);
    expect(parseNumber("n/a")).toBeNull();
  });

  it("splits quoted fields with separators and doubled quotes inside", () => {
    expect(splitCsv('a,"b, c","say ""hi"""\r\n1,2,3', ",")).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });
});

describe("a broker's trade history", () => {
  it("English export: actions as words, dates month/day, fees; dividends are skipped, not errors", () => {
    const csv = ["Date,Action,Symbol,Quantity,Price,Fees & Comm,Amount", "11/03/2026,Buy,AAPL,10,$228.50,$1.00,-$2286.00", "11/15/2026,Sell,AAPL,4,$240.00,$1.00,$959.00", "11/16/2026,Qualified Dividend,AAPL,,,,$2.40", "11/18/2026,Buy,NOT A TICKER!,1,10,,"].join("\n");
    const r = parseBrokerCsv(csv, TODAY);
    expect(r).toMatchObject({ kind: "trades", missing: [], dateOrder: "mdy", dateAmbiguous: false }); // 15 can't be a month
    expect(trades(r)).toEqual([
      { symbol: "AAPL", side: "buy", date: "2026-11-03", shares: 10, price: 228.5, fees: 1 },
      { symbol: "AAPL", side: "sell", date: "2026-11-15", shares: 4, price: 240, fees: 1 },
    ]);
    expect(problems(r)).toEqual(["4:notTrade", "5:symbol"]);
  });

  it("Spanish export with semicolons and decimal commas: day/month dates, SIC tickers with an asterisk", () => {
    const csv = ["Fecha de operación;Emisora;Tipo;Títulos;Precio;Comisión", "21/10/2026;AAPL *;Compra;3;4.215,30;12,50", "05/11/2026;MSFT *;Venta;1;8.010,00;0"].join("\n");
    const r = parseBrokerCsv(csv, TODAY);
    expect(r.dateOrder).toBe("dmy");
    expect(r.dateAmbiguous).toBe(false); // 21 can't be a month
    expect(trades(r)).toEqual([
      { symbol: "AAPL", side: "buy", date: "2026-10-21", shares: 3, price: 4215.3, fees: 12.5 },
      { symbol: "MSFT", side: "sell", date: "2026-11-05", shares: 1, price: 8010, fees: 0 },
    ]);
  });

  it("finds the header after preamble lines and reads sells from negative quantities", () => {
    const csv = ["Statement,Header,Field Name,Field Value", "Statement,Data,Period,2026", "Trades,Header,Symbol,Date/Time,Quantity,T. Price,Comm/Fee", 'Trades,Data,NVDA,"2026-11-02, 10:31:00",5,140.25,-1', 'Trades,Data,NVDA,"2026-11-09, 15:02:11",-5,150,-1'].join("\n");
    const r = parseBrokerCsv(csv, TODAY);
    expect(trades(r)).toEqual([
      { symbol: "NVDA", side: "buy", date: "2026-11-02", shares: 5, price: 140.25, fees: 1 },
      { symbol: "NVDA", side: "sell", date: "2026-11-09", shares: 5, price: 150, fees: 1 },
    ]);
  });

  it("derives the price from the amount, reads named months, refuses future dates", () => {
    const csv = ["Run Date,Action,Symbol,Quantity,Amount", "\"Nov 2, 2026\",YOU BOUGHT,KO,10,-680.00", "2-dic-2026,YOU BOUGHT,KO,1,-68"].join("\n");
    const r = parseBrokerCsv(csv, TODAY);
    expect(trades(r)).toEqual([{ symbol: "KO", side: "buy", date: "2026-11-02", shares: 10, price: 68, fees: 0 }]);
    expect(problems(r)).toEqual(["3:future"]);
  });

  it("lets the user settle an ambiguous date order", () => {
    const csv = ["Date,Action,Symbol,Quantity,Price", "03/11/2026,Buy,AAPL,1,200"].join("\n");
    expect(trades(parseBrokerCsv(csv, TODAY))[0].date).toBe("2026-03-11");
    expect(trades(parseBrokerCsv(csv, TODAY, { order: "dmy" }))[0].date).toBe("2026-11-03");
  });
});

describe("a holdings list (no dates, no sides)", () => {
  it("becomes buys on the chosen date at the average cost", () => {
    const csv = ["Symbol,Description,Quantity,Average Cost,Market Value", "VOO,Vanguard S&P 500,2.5,480.10,1300", "TSLA,Tesla,3,210,700"].join("\n");
    const r = parseBrokerCsv(csv, TODAY, { holdingsDate: "2026-11-01" });
    expect(r.kind).toBe("holdings");
    expect(trades(r)).toEqual([
      { symbol: "VOO", side: "buy", date: "2026-11-01", shares: 2.5, price: 480.1, fees: 0 },
      { symbol: "TSLA", side: "buy", date: "2026-11-01", shares: 3, price: 210, fees: 0 },
    ]);
  });

  it("says which columns it couldn't find", () => {
    expect(parseBrokerCsv("Name,Weight\nApple,10%", TODAY).missing).toEqual(["symbol", "shares", "price"]);
    expect(parseBrokerCsv("Symbol,Quantity\nAAPL,1", TODAY).missing).toEqual(["price"]);
  });
});
