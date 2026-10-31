import type { ReactNode } from "react";
import { defineMsgs } from "../lang";

/** The payouts page (components/payouts/PayoutsView.tsx). The lede's verb comes from deliveryCopy (lib/copy.ts). */
export const payouts = defineMsgs(
  {
    title: "Payouts",
    lede: (verb: string) => `Every hour each coin's vault buys its stock and ${verb} holders. These are the receipts, newest first. Each one is a transaction you can open.`,
    tilePaid: "Paid to holders",
    tileRounds: "Payout rounds",
    tileWallets: "Wallet payments",
    tilePending: "Waiting for the next round",
    meter: "Payout meter, all coins",
    late: (n: number) => `${n} ${n === 1 ? "coin is" : "coins are"} late`,
    onTime: "Every coin on time",
    legendPaid: "Paid",
    legendWaiting: (countdown: ReactNode) => (
      <>
        Waiting, next round in&nbsp;<b>{countdown}</b>
      </>
    ),
    legendLate: "Late, shown per coin",
    receipts: "Receipts",
    filterLabel: "Filter receipts by stock",
    all: "All",
    colCoin: "Coin",
    colWhen: "When",
    colPaid: "Paid",
    colValue: "Value",
    colWallets: "Wallets",
    colTx: "Tx",
    loadError: "Couldn't load these receipts. Try again in a moment.",
    loading: "Loading…",
  },
  {
    title: "分红记录",
    lede: (verb: string) => `每小时，每个代币的金库买入它的股票，${verb}持有人。下面是分红收据，最新的在前。每一条都是一笔可以打开查看的交易。`,
    tilePaid: "已分给持有人",
    tileRounds: "分红轮次",
    tileWallets: "钱包分红笔数",
    tilePending: "等待下一轮",
    meter: "分红进度，全部代币",
    late: (n: number) => `${n} 个代币延迟`,
    onTime: "所有代币都准时",
    legendPaid: "已分红",
    legendWaiting: (countdown: ReactNode) => (
      <>
        等待中，距下一轮&nbsp;<b>{countdown}</b>
      </>
    ),
    legendLate: "延迟，按代币显示",
    receipts: "收据",
    filterLabel: "按股票筛选收据",
    all: "全部",
    colCoin: "代币",
    colWhen: "时间",
    colPaid: "分红",
    colValue: "价值",
    colWallets: "钱包数",
    colTx: "交易",
    loadError: "收据加载失败，请稍后再试。",
    loading: "加载中…",
  },
);
