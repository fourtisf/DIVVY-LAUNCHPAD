import { defineMsgs } from "../lang";

/** The candle chart's legend (components/coin/CandleChart.tsx). Chinese charts label OHLC 开高低收. */
export const chart = defineMsgs(
  { o: "O", h: "H", l: "L", c: "C", vol: "Vol", empty: "No trades yet. The first one draws the first candle." },
  { o: "开", h: "高", l: "低", c: "收", vol: "量", empty: "还没有交易。第一笔交易会画出第一根 K 线。" },
);
