import Link from "next/link";
import { defineMsgs } from "../lang";

/** The board: hero, stats, leaders, coin grid, coin table and envelope cards (components/board, CoinCard). */
export const board = defineMsgs(
  {
    paidThisHour: (usd: string) => `Holders paid ${usd} in stocks this hour`,
    untilNext: "until the next payout",
    h1: (
      <>
        Memecoins that pay you <em>real stock dividends.</em>
      </>
    ),
    lede: (paidLaunch: boolean, tail: string) => `Launch a coin${paidLaunch ? " in seconds" : " for free"}. Every trade buys the stock you picked, like NVDAx or SPYx, ${tail}`,
    createCoin: "Create a coin",
    howItWorks: "How it works",
    devBuysShown: (paidLaunch: boolean): string => (paidLaunch ? "Dev buys shown" : "Free, dev buys shown"),
    liquidityLocked: "Liquidity locked for good",
    noSniper: "No sniper in block 0",
    payoutsOnChain: "Every payout on chain",
    nextPayout: "Next payout",
    lastRound: "Last hourly round",
    paidToWallets: (n: string) => `paid to ${n} wallets`,
    paidToHolders: "Paid to holders",
    traded24h: "Traded in 24h",
    coinsLive: "Coins live",
    stocksToEarn: "Stocks to earn",
    leadersH: "Paying the most today",
    leadersP: "Ranked by what holders were paid in the last 24 hours.",
    leaderTick: (ticker: string, mcap: string) => `$${ticker}, ${mcap} market cap`,
    paidToday: "paid today",
    leaderTotal: (paid: string, holders: string) => `${paid} paid · ${holders} holders`,
    colCoin: "Coin",
    colMcap: "Market cap",
    col24h: "24h",
    colCurve: "Bonding curve",
    colPays: "Pays in",
    colPaid: "Paid out",
    colHolders: "Holders",
    colAge: "Age",
    ageShort: (ago: string) => ago.replace(/ ago$/, ""),
    allCoins: "All coins",
    sort: "Sort",
    sorts: { trending: "Trending", new: "New", payers: "Top payers", graduate: "About to graduate" },
    filterByStock: "Filter by stock",
    paysIn: "Pays in",
    all: "All",
    noMatch: (q: string) => (
      <>
        No coin matches “{q}”. Try a ticker, a name, a CA or a stock like NVDAx, or <Link className="link" href="/create">create it yourself</Link>.
      </>
    ),
    badgeNew: "New",
    badgeGraduated: "Graduated",
    devBadge: (share: string) => `Dev ${share}`,
    devBadgeTitle: (share: string) => `The creator bought ${share} of the supply in the create`,
    agoBy: (ago: string, creator: string) => `${ago} by ${creator}`,
    marketCap: "Market cap",
    bondingCurve: "Bonding curve",
    paidOut: "paid out",
    holders: "holders",
  },
  {
    paidThisHour: (usd: string) => `本小时已发 ${usd} 美股红包`,
    untilNext: "距离下一个红包",
    h1: (
      <>
        土狗也分红，
        <br />
        <em>分的是美股。</em>
      </>
    ),
    lede: (paidLaunch: boolean, tail: string) => `${paidLaunch ? "几秒钟就能发币。" : "免费发币。"}每一笔交易都会买入你选的股票代币，比如 NVDAx、SPYx，${tail}`,
    createCoin: "创建代币",
    howItWorks: "玩法说明",
    devBuysShown: (paidLaunch: boolean) => (paidLaunch ? "开发者首买公开" : "免费发币，开发者首买公开"),
    liquidityLocked: "流动性永久锁定",
    noSniper: "0 号区块无狙击",
    payoutsOnChain: "每笔分红链上可查",
    nextPayout: "下次分红",
    lastRound: "上一轮分红",
    paidToWallets: (n: string) => `已分给 ${n} 个钱包`,
    paidToHolders: "累计分红",
    traded24h: "24 小时交易额",
    coinsLive: "在线代币",
    stocksToEarn: "可分红股票",
    leadersH: "今日分红最多",
    leadersP: "按过去 24 小时持有人所得排名。",
    leaderTick: (ticker: string, mcap: string) => `$${ticker}，市值 ${mcap}`,
    paidToday: "今日已分",
    leaderTotal: (paid: string, holders: string) => `累计 ${paid} · ${holders} 人`,
    colCoin: "代币",
    colMcap: "市值",
    col24h: "24h",
    colCurve: "内盘进度",
    colPays: "分红资产",
    colPaid: "已分红",
    colHolders: "持有人",
    colAge: "上线",
    ageShort: (ago: string) => ago.replace(/前$/, ""),
    allCoins: "全部代币",
    sort: "排序",
    sorts: { trending: "热门", new: "最新", payers: "分红最多", graduate: "即将毕业" },
    filterByStock: "按股票筛选",
    paysIn: "分红资产",
    all: "全部",
    noMatch: (q: string) => (
      <>
        没有匹配“{q}”的代币。试试代币符号、名称、合约地址或股票（比如 NVDAx），或者<Link className="link" href="/create">自己创建一个</Link>。
      </>
    ),
    badgeNew: "新币",
    badgeGraduated: "已毕业",
    devBadge: (share: string) => `首买 ${share}`,
    devBadgeTitle: (share: string) => `创建者在创建时买入了 ${share} 的供应量`,
    agoBy: (ago: string, creator: string) => `${ago} · ${creator} 创建`,
    marketCap: "市值",
    bondingCurve: "内盘进度",
    paidOut: "已分红",
    holders: "持有人",
  },
);
