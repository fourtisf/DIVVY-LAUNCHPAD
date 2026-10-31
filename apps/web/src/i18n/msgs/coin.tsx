import type { ReactNode } from "react";
import { BRAND } from "@/lib/brand";
import { defineMsgs } from "../lang";

/** Renders a link around its text; the component keeps the link's markup, the message its words. */
type LinkFn = (text: string) => ReactNode;

/** A coin's page (app/coin/[ticker], components/coin/CoinView). */
export const coinMsgs = defineMsgs(
  {
    sameTicker: (n: number) => `${n} coins use this ticker. Pick one, and check its address against the one the project posts.`,
    noCoin: (ticker: string, create: LinkFn) => (
      <>
        There&apos;s no coin called ${ticker} here yet. {create("Create it")}.
      </>
    ),
    coinFallback: "Coin",
    loading: "Loading the coin…",
    kpiMcap: "Market cap",
    kpiChange: "24h change",
    kpiVolume: "24h volume",
    kpiHolders: "Holders",
    kpiPaid: "Paid to holders",
    statusLate: "Late",
    statusCarried: "Carried to next round",
    statusOnTime: "On time",
    caCopied: "Contract address copied",
    coinTitle: (ticker: string, asset: string) => `Front: $${ticker}. Back: ${asset}`,
    createdBy: (creator: string, ago: string) => `Created by ${creator} ${ago}`,
    copyCa: "Copy contract address",
    privateBundle: "Private bundle launch",
    devBoughtTitle: (share: string) => `The creator bought ${share} of the supply inside the create`,
    noDevBuyTitle: "The creator didn't buy any in the create",
    devBought: (share: string) => `Dev bought ${share}`,
    noDevBuy: "No dev buy",
    candleSize: "Candle size",
    chartOf: "Chart of",
    price: "Price",
    marketCap: "Market cap",
    chartLabel: (unit: "price" | "mcap", ticker: string) => `${unit === "price" ? "Price" : "Market cap"} chart for $${ticker}`,
    ath: (usd: string) => `Market cap all-time high ${usd}`,
    hourlyPayout: "Hourly payout to holders",
    tabs: { payouts: "Payouts", holders: "Holders", trades: "Trades" },
    thWhen: "When",
    thPaid: "Paid",
    thValue: "Value",
    thWallets: "Wallets",
    thTx: "Tx",
    thWallet: "Wallet",
    thShare: "Share",
    thReceived: "Received",
    thSide: "Side",
    noPayout: (countdown: ReactNode, minHolder: string) => (
      <>
        No payout yet. The first round runs at the top of the hour, {countdown} from now, for every wallet holding at least {minHolder}.
      </>
    ),
    notPaid: "not paid",
    na: "n/a",
    side: { buy: "buy", sell: "sell" },
    noTrades: "No trades yet. The first buyer gets the lowest price on the curve.",
    paidIn: "Holders are paid in",
    nextPayout: "Next payout",
    paidSoFar: "Paid out so far",
    worth: "Worth",
    ifYouHold: (share: ReactNode) => <>If you hold {share} of supply</>,
    calcOut: (amount: ReactNode, worth: ReactNode) => (
      <>
        At today&apos;s volume you&apos;d receive about {amount} a day, worth {worth}.
      </>
    ),
    cardNote: (minHolder: string, d: { claim: boolean; cardNoteVerb: string }) =>
      `Wallets holding at least ${minHolder} at the hourly snapshot are ${d.cardNoteVerb}. The curve, the pool and the launcher wallet are left out.`,
    whereFee: "Where the fee goes",
    buysFor: (asset: string) => `Buys ${asset} for holders`,
    creator: "Creator",
    raydiumProtocol: "Raydium protocol",
    meter: "Payout meter",
    paid24h: "Paid to holders, last 24h",
    waiting: "Waiting for the next round",
    lastPayout: "Last payout",
    firstPending: "First round pending",
    feesNote: (lateMin: number) => `Fees sit in this coin's own on-chain vault until the hourly round. A round more than ${lateMin} minutes late turns this red for everyone.`,
    checkAddress: "Check the address",
    checkNote: (ticker: string, mint: ReactNode) => (
      <>
        Coins on {BRAND} can share a ticker, a name, a picture and an X account. This ${ticker} is {mint}: compare it with the address the project posts before you buy.
      </>
    ),
  },
  {
    sameTicker: (n: number) => `有 ${n} 个代币使用这个代币符号。选一个，并把它的地址和项目方公布的地址核对一下。`,
    noCoin: (ticker: string, create: LinkFn) => (
      <>
        这里还没有叫 ${ticker} 的代币。{create("去创建一个")}。
      </>
    ),
    coinFallback: "代币",
    loading: "正在加载代币…",
    kpiMcap: "市值",
    kpiChange: "24 小时涨跌",
    kpiVolume: "24 小时交易额",
    kpiHolders: "持有人",
    kpiPaid: "累计分红",
    statusLate: "延迟",
    statusCarried: "顺延到下一轮",
    statusOnTime: "准时",
    caCopied: "合约地址已复制",
    coinTitle: (ticker: string, asset: string) => `正面 $${ticker}，背面 ${asset}`,
    createdBy: (creator: string, ago: string) => `${creator} ${ago}创建`,
    copyCa: "复制合约地址",
    privateBundle: "私密捆绑发币",
    devBoughtTitle: (share: string) => `创建者在创建时买入了 ${share} 的供应量`,
    noDevBuyTitle: "创建者在创建时没有买入",
    devBought: (share: string) => `开发者首买 ${share}`,
    noDevBuy: "无开发者首买",
    candleSize: "K 线周期",
    chartOf: "图表数据",
    price: "价格",
    marketCap: "市值",
    chartLabel: (unit: "price" | "mcap", ticker: string) => `$${ticker} ${unit === "price" ? "价格" : "市值"}走势图`,
    ath: (usd: string) => `历史最高市值 ${usd}`,
    hourlyPayout: "每小时持有人分红",
    tabs: { payouts: "分红", holders: "持有人", trades: "交易" },
    thWhen: "时间",
    thPaid: "分红",
    thValue: "价值",
    thWallets: "钱包数",
    thTx: "交易",
    thWallet: "钱包",
    thShare: "占比",
    thReceived: "已收到",
    thSide: "方向",
    noPayout: (countdown: ReactNode, minHolder: string) => (
      <>
        还没有分红。第一轮在整点开始，还有 {countdown}，所有持有至少 {minHolder} 的钱包都能分到。
      </>
    ),
    notPaid: "不分红",
    na: "无",
    side: { buy: "买入", sell: "卖出" },
    noTrades: "还没有交易。第一个买家能拿到内盘上的最低价。",
    paidIn: "分红资产",
    nextPayout: "下次分红",
    paidSoFar: "累计已分红",
    worth: "价值",
    ifYouHold: (share: ReactNode) => <>如果你持有供应量的 {share}</>,
    calcOut: (amount: ReactNode, worth: ReactNode) => (
      <>
        按今天的交易额，你每天大约能收到 {amount}，价值 {worth}。
      </>
    ),
    cardNote: (minHolder: string, d: { claim: boolean; cardNoteVerb: string }) =>
      `${d.claim ? "分红每小时记入" : "分红每小时发给"}快照时持有至少 ${minHolder} 的钱包。内盘、池子和发币钱包不参与分红。`,
    whereFee: "手续费去向",
    buysFor: (asset: string) => `为持有人买入 ${asset}`,
    creator: "创建者",
    raydiumProtocol: "Raydium 协议",
    meter: "分红状态",
    paid24h: "过去 24 小时分给持有人",
    waiting: "等待下一轮",
    lastPayout: "上次分红",
    firstPending: "等待第一轮",
    feesNote: (lateMin: number) => `每小时一轮分红之前，手续费存放在这个代币自己的链上金库里。某一轮延迟超过 ${lateMin} 分钟，这里会对所有人变红。`,
    checkAddress: "核对合约地址",
    checkNote: (ticker: string, mint: ReactNode) => (
      <>
        {BRAND} 上的代币可以使用相同的代币符号、名称、图片和 X 账号。这个 ${ticker} 的地址是 {mint}，买入前请和项目方公布的地址核对。
      </>
    ),
  },
);

/** The buy/sell box (components/coin/TradeBox). */
export const tradeMsgs = defineMsgs(
  {
    lastFailed: "Your last trade failed on chain. Only the network fee was spent.",
    lastWentThrough: "Your last trade went through.",
    enterAmount: "Enter an amount like 0.5",
    demoBought: (recv: string) => `Bought ${recv} (demo)`,
    demoSold: (recv: string) => `Sold for ${recv} (demo)`,
    quoteMismatch: "The quote didn't match your slippage setting. Nothing was sent.",
    lessThanShown: (out: string, unit: string, min: string) => `You'd get about ${out} ${unit} (at least ${min}), less than shown. Continue?`,
    priceImpact: (pct: string) => `This trade moves the price by about ${pct}%. Continue?`,
    bought: (amount: string, ticker: string) => `Bought ${amount} $${ticker}`,
    sold: (sol: string) => `Sold for ${sol}`,
    tradeFailed: "The trade didn't go through. Nothing was sent.",
    buyOrSell: "Buy or sell",
    buy: "Buy",
    sell: "Sell",
    youPay: "You pay",
    youSell: "You sell",
    balanceSol: (sol: string) => `Balance ${sol} SOL`,
    balanceTokens: (amount: string, ticker: string) => `Balance ${amount} $${ticker}`,
    amount: "Amount",
    youReceive: "You receive",
    route: "Route",
    routeBuyPool: "SOL into the Raydium pool",
    routeBuyCurve: "SOL into the bonding curve",
    routeSellPool: "Raydium pool to SOL",
    routeSellCurve: "Bonding curve to SOL",
    tradingFee: "Trading fee",
    /** `holders` is null when holders get exactly half of the fee. */
    feeLabel: (fee: string, holders: string | null) => `${fee}%, ${holders === null ? "half of it" : `${holders} of it`} to holders`,
    maxSlippage: "Max slippage",
    connectToTrade: "Connect wallet to trade",
    confirming: "Confirming on Solana…",
    approve: "Approve in your wallet…",
    buyTicker: (ticker: string) => `Buy $${ticker}`,
    sellTicker: (ticker: string) => `Sell $${ticker}`,
    failedNote: (expired: boolean, solscan: LinkFn) => (
      <>
        {expired ? "Your last trade didn't land in time. Nothing was spent." : "Your last trade failed on chain; only the network fee was spent."}{" "}
        {solscan("See it on Solscan")}
        {expired ? ", then try again." : ". A price that moved more than your max slippage is the usual reason: try again, or raise it."}
      </>
    ),
    unconfirmedNote: (solscan: LinkFn) => (
      <>
        Your last trade was sent but isn&apos;t confirmed yet.{" "}
        {solscan("Check it on Solscan")} before you trade again.
      </>
    ),
    iChecked: "I checked it",
    graduated: "Graduated. Trades go to the Raydium pool.",
    curve: (target: string) => `Bonding curve, graduates at ${target}`,
  },
  {
    lastFailed: "你上一笔交易在链上失败了。只花了网络手续费。",
    lastWentThrough: "你上一笔交易已成功。",
    enterAmount: "请输入金额，比如 0.5",
    demoBought: (recv: string) => `已买入 ${recv}（演示）`,
    demoSold: (recv: string) => `已卖出，得到 ${recv}（演示）`,
    quoteMismatch: "报价和你设置的滑点不符。没有发送任何交易。",
    lessThanShown: (out: string, unit: string, min: string) => `你大约会收到 ${out} ${unit}（至少 ${min}），比显示的少。继续吗？`,
    priceImpact: (pct: string) => `这笔交易会让价格变动约 ${pct}%。继续吗？`,
    bought: (amount: string, ticker: string) => `已买入 ${amount} $${ticker}`,
    sold: (sol: string) => `已卖出，得到 ${sol}`,
    tradeFailed: "交易没有成功。没有发送任何交易。",
    buyOrSell: "买入或卖出",
    buy: "买入",
    sell: "卖出",
    youPay: "你支付",
    youSell: "你卖出",
    balanceSol: (sol: string) => `余额 ${sol} SOL`,
    balanceTokens: (amount: string, ticker: string) => `余额 ${amount} $${ticker}`,
    amount: "数量",
    youReceive: "你将收到",
    route: "路径",
    routeBuyPool: "SOL 进入 Raydium 池子",
    routeBuyCurve: "SOL 进入内盘",
    routeSellPool: "Raydium 池子换成 SOL",
    routeSellCurve: "内盘换成 SOL",
    tradingFee: "交易手续费",
    feeLabel: (fee: string, holders: string | null) => `${fee}%，其中${holders === null ? "一半" : ` ${holders} `}分给持有人`,
    maxSlippage: "最大滑点",
    connectToTrade: "连接钱包后交易",
    confirming: "正在 Solana 上确认…",
    approve: "请在钱包中确认…",
    buyTicker: (ticker: string) => `买入 $${ticker}`,
    sellTicker: (ticker: string) => `卖出 $${ticker}`,
    failedNote: (expired: boolean, solscan: LinkFn) =>
      expired ? (
        <>
          你上一笔交易没能及时上链，没有花费任何资金。先{solscan("在 Solscan 上查看")}，然后重试。
        </>
      ) : (
        <>
          你上一笔交易在链上失败了，只花了网络手续费。{solscan("在 Solscan 上查看")}。最常见的原因是价格变动超过了你的最大滑点：请重试，或者调高滑点。
        </>
      ),
    unconfirmedNote: (solscan: LinkFn) => <>你上一笔交易已发送，但还没确认。再次交易之前，先{solscan("在 Solscan 上查看")}。</>,
    iChecked: "我已查看",
    graduated: "已毕业。交易会进入 Raydium 池子。",
    curve: (target: string) => `内盘，达到 ${target} 后毕业`,
  },
);

/** The creator's fee panel on their own coin's page (components/coin/CreatorFees). */
export const creatorFeesMsgs = defineMsgs(
  {
    claimed: "Creator fees claimed",
    claimFailed: "The claim didn't go through. Nothing was sent.",
    title: "Your creator fees",
    signInNote: "You made this coin. Sign in to see the fees its trades left you and claim them.",
    signInFailed: "Couldn't sign in. Try again.",
    signInToClaim: "Sign in to claim",
    loading: "Loading…",
    earnedOn: (ticker: string) => `Earned on $${ticker}`,
    ready: "Ready to claim, all your coins",
    claiming: "Claiming…",
    nothing: "Nothing to claim yet",
    claim: (sol: string) => `Claim ${sol}`,
    /** `seeClaim` is null until a claim landed on this page. */
    note: (share: string, seeClaim: LinkFn | null, allCoins: LinkFn) => (
      <>
        Your {share}% of every trade on the curve collects on chain in your own creator vault. Claiming sends it to this wallet.{" "}
        {seeClaim && (
          <>
            {seeClaim("See the claim")}.{" "}
          </>
        )}
        {allCoins("All your coins")}
      </>
    ),
  },
  {
    claimed: "创建者手续费已领取",
    claimFailed: "领取没有成功。没有发送任何交易。",
    title: "我的创建者手续费",
    signInNote: "这个代币是你创建的。登录后可以查看它的交易给你带来的手续费，并领取。",
    signInFailed: "登录失败，请重试。",
    signInToClaim: "登录后领取",
    loading: "加载中…",
    earnedOn: (ticker: string) => `在 $${ticker} 上赚到`,
    ready: "可领取（你的全部代币）",
    claiming: "领取中…",
    nothing: "暂时没有可领取的",
    claim: (sol: string) => `领取 ${sol}`,
    note: (share: string, seeClaim: LinkFn | null, allCoins: LinkFn) => (
      <>
        内盘上每笔交易的 {share}% 归你，在链上累积到你自己的创建者金库。领取会把它发到这个钱包。
        {seeClaim && <>{seeClaim("查看领取交易")}。</>}
        {allCoins("我的全部代币")}
      </>
    ),
  },
);

/** "Report" on a coin's page (components/coin/ReportButton). */
export const reportMsgs = defineMsgs(
  {
    thanks: "Thanks. We'll take a look.",
    failed: "The report didn't go through. Try again.",
    report: "Report",
    title: (ticker: string) => `Report $${ticker}`,
    intro: `Tell us what's wrong. Reports go to ${BRAND}'s moderators.`,
    reason: "Reason",
    reasons: { copy: "It copies another coin", scam: "It's a scam", nsfw: "Not safe for work", illegal: "Illegal content", other: "Something else" },
    details: "Details, links (optional)",
    cancel: "Cancel",
    send: "Send report",
  },
  {
    thanks: "谢谢。我们会看一下。",
    failed: "举报没有发送成功，请重试。",
    report: "举报",
    title: (ticker: string) => `举报 $${ticker}`,
    intro: `告诉我们哪里有问题。举报会发给 ${BRAND} 的管理员。`,
    reason: "原因",
    reasons: { copy: "仿盘，抄了别的代币", scam: "这是骗局", nsfw: "不适合公开浏览", illegal: "违法内容", other: "其他问题" },
    details: "详情、链接（选填）",
    cancel: "取消",
    send: "发送举报",
  },
);
