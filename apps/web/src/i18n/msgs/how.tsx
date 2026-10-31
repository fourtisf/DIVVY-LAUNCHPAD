import { BRAND } from "@/lib/brand";
import { defineMsgs } from "../lang";

type CurveSplit = { holders: string; creator: string; divvy: string; protocol: string };
type PayoutStep = { verb: string; extra: string; min: string; lateMin: number };
type Graduation = { total: string; curve: string; migrate: string; sol: number; cap: string };
type AfterGrad = { total: string; trade: string; pool: string; creatorFee: string; raydiumPool: number; raydiumCreator: number; holders: string; creator: string; divvy: string };

/**
 * How it works (app/how/page.tsx). Every number is computed on the page from /api/config and passed in.
 * The step 6 title and the verb and extra sentence of its body come from deliveryCopy (lib/copy.ts).
 */
export const how = defineMsgs(
  {
    title: `How ${BRAND} works`,
    lede: "A memecoin you buy with SOL. A dividend you're paid in a real stock token. Here's the path from a form to a payout.",
    step1Title: "You fill in the form",
    step1Body: (cost: string) => `Name, ticker, picture and the stock your holders will earn: NVDAx, SPYx, TSLAx and the rest. ${cost} The stock is locked once the coin is live.`,
    launchCostFee: (fee: number, create: number) => `Launching costs the ${fee} SOL fee and about ${create} SOL to create the coin, both in the one transaction your wallet signs: a launch that doesn't land costs nothing.`,
    launchCostCreate: (create: number) => `Launching costs about ${create} SOL to create the coin, in the transaction your wallet signs.`,
    launchFree: "Launching costs nothing.",
    step2Title: "Any name, any ticker",
    step2Body: "Coins can share a ticker, a name, a picture and an X account, so the contract address is what tells them apart. Every coin page shows it: check it against the address the project posts before you buy.",
    step3Title: "Your wallet creates it, in a private bundle",
    step3Body:
      "Your wallet signs and pays for the create on a Raydium LaunchLab bonding curve, so on chain and on explorers the coin is yours. The create goes out as a private bundle and the address isn't shown to anyone else before it lands, so nobody can buy in the block it's created in. You can add a dev buy to the create: it's the coin's first trade, before anyone else's, and the coin page shows everyone how much you bought.",
    step4Title: (trade: string) => `Every trade on the curve pays ${trade}`,
    step4Body: (s: CurveSplit) =>
      `Raydium's LaunchLab program takes the fee on chain, on every buy and every sell: ${s.holders} for holders, ${s.creator} for the creator, ${s.divvy} for ${BRAND} and ${s.protocol} for Raydium. The creator's share goes straight to their own fee vault, and they claim it from their page. The holders' and ${BRAND}'s share goes to ${BRAND}'s fee vault, and each trade's record says which coin paid it, so every coin's dividend is exactly what its own trades paid. Nothing is estimated.`,
    step5Title: (protocol: string) => `Why Raydium gets ${protocol}`,
    step5Body: (protocol: string, trade: string) =>
      `The bonding curve and the pool after it are Raydium's programs, not ${BRAND}'s. Raydium charges its own ${protocol} on every curve trade for running them, and its own wallet moves the coin into the pool when it graduates. ${BRAND} can't turn that fee off and doesn't receive any of it. The ${trade} you see is the whole fee, Raydium's part included.`,
    step6Body: (p: PayoutStep) =>
      `At the top of each hour the vault buys the coin's stock token and ${p.verb} every wallet holding at least ${p.min}, in proportion to what they hold. The curve, the pool and the launcher wallet are left out.${p.extra} Each round is a receipt on the payouts page, and a round more than ${p.lateMin} minutes late turns red.`,
    step7Title: (sol: number) => `At ${sol} SOL it graduates to a Raydium pool`,
    step7Body: (g: Graduation) =>
      `Every coin has ${g.total} tokens. The curve sells ${g.curve} of them, and the price rises with each buy. When buyers have put ${g.sol} SOL into the curve, the coin graduates: Raydium moves those ${g.sol} SOL, less its migration fee if it charges one, and the other ${g.migrate} tokens into a new Raydium pool. That's a market cap of about ${g.cap} at today's SOL price. From then on the coin trades in the pool.`,
    step8Title: "The pool's liquidity is locked for good, not burned",
    step8Body: (sol: number) =>
      `All of the pool's liquidity is locked with Raydium Burn & Earn, which has no way to withdraw it. Nobody can ever pull those ${sol} SOL out of the pool, ${BRAND} included. For holders that's as safe as burning it, with one difference: locked liquidity keeps earning the pool's trading fees, and those fees keep paying the dividend. Burned liquidity would earn nothing.`,
    step9Title: (total: string) => `After graduation the fee drops to ${total}`,
    step9Body: (a: AfterGrad) =>
      `A trade in the Raydium pool pays ${a.total} instead of ${a.trade}: the pool's ${a.pool} trading fee plus a ${a.creatorFee} creator fee. Raydium keeps ${a.raydiumPool}% of the ${a.pool} and ${a.raydiumCreator}% of the creator fee, and the locked liquidity earns the rest. ${BRAND} collects that along with the rest of the creator fee and splits it: ${a.holders} to holders, ${a.creator} to the creator and ${a.divvy} to ${BRAND}. Dividends keep coming every hour, just smaller per dollar traded.`,
    feesTitle: "Where the fee goes",
    feesSub: "Per $1,000 traded",
    colCurve: "On the curve",
    colAfter: "After graduation",
    rowTrader: "The trader pays",
    rowHolders: "Holders' dividend",
    rowCreator: "Creator",
    rowLiquidity: "Liquidity",
    liqCurve: "In the curve",
    liqLocked: "Locked for good",
    fine1: "Tokenized stocks are issued by third parties such as xStocks. They track a share's price but carry no voting rights, and may be unavailable in some countries, including the United States.",
    fine2: "A stock token trades around the clock while the real market closes at night and on weekends, so its price can jump when the market reopens.",
    fine3: `After graduation, half of the locked liquidity's fees arrive in the coin itself, and ${BRAND} sells them for SOL before the payout. The figures after graduation are rounded and can move by a few cents with Raydium's pool settings.`,
    fine4: "Most new coins never graduate. Payouts depend entirely on trading volume. Nothing here is financial advice.",
    createCoin: "Create a coin",
  },
  {
    title: `${BRAND} 是怎么运作的`,
    lede: "用 SOL 买入代币，分红用真实的股票代币发放。下面是从填写表单到收到分红的完整流程。",
    step1Title: "填写表单",
    step1Body: (cost: string) => `填上名称、代币符号、图片，再选好持有人将获得的股票：NVDAx、SPYx、TSLAx 等。${cost}代币上线后，分红资产就锁定了。`,
    launchCostFee: (fee: number, create: number) => `发币要付 ${fee} SOL 手续费，另加约 ${create} SOL 的代币创建费用，两笔都在你的钱包签名的同一笔交易里：发币没有上链就不花钱。`,
    launchCostCreate: (create: number) => `发币约需 ${create} SOL 用来创建代币，包含在你的钱包签名的交易里。`,
    launchFree: "发币免费。",
    step2Title: "名称和代币符号不设限",
    step2Body: "不同代币可以用同一个代币符号、名称、图片和 X 账号，所以要靠合约地址区分。每个代币页面都会显示合约地址：买入前，先和项目方公布的地址核对一下。",
    step3Title: "你的钱包用私密捆绑交易创建代币",
    step3Body:
      "代币在 Raydium LaunchLab 内盘上创建，由你的钱包签名并付费，所以在链上和区块浏览器上，这个代币都属于你。创建交易以私密捆绑交易发出，上链之前不会向其他任何人显示合约地址，所以没人能在创建它的那个区块里买入。你可以在创建时加上开发者首买：这是代币的第一笔交易，排在所有人之前，代币页面会向所有人显示你买了多少。",
    step4Title: (trade: string) => `内盘上的每笔交易支付 ${trade}`,
    step4Body: (s: CurveSplit) =>
      `手续费由 Raydium 的 LaunchLab 程序在链上收取，每笔买入和卖出都收：${s.holders} 给持有人，${s.creator} 给创建者，${s.divvy} 给 ${BRAND}，${s.protocol} 给 Raydium。创建者的部分直接进入创建者自己的手续费金库，创建者在自己的页面上领取。持有人和 ${BRAND} 的部分进入 ${BRAND} 的手续费金库，每笔交易的记录都写明是哪个代币付的，所以每个代币的分红正好等于它自己的交易付出的手续费。没有任何估算。`,
    step5Title: (protocol: string) => `为什么 Raydium 收取 ${protocol}`,
    step5Body: (protocol: string, trade: string) =>
      `内盘和毕业后的池子都是 Raydium 的程序，不是 ${BRAND} 的。Raydium 运行这些程序，在内盘的每笔交易上收取自己的 ${protocol}，代币毕业时也由它自己的钱包把代币迁入池子。${BRAND} 无法关掉这笔手续费，也拿不到其中任何一部分。你看到的 ${trade} 就是全部手续费，已经包含 Raydium 的部分。`,
    // deliveryCopy's zh extra sentence can start with a space; between Chinese sentences there is none.
    step6Body: (p: PayoutStep) =>
      `每小时整点，金库买入该代币的股票代币，按持有量${p.verb}每个持有至少 ${p.min} 的钱包。内盘、池子和平台发币钱包不参与分红。${p.extra.trim()}每一轮分红都是分红记录页上的一张收据，晚了超过 ${p.lateMin} 分钟的一轮会标红。`,
    step7Title: (sol: number) => `达到 ${sol} SOL 后毕业，进入 Raydium 池子`,
    step7Body: (g: Graduation) =>
      `每个代币的总量都是 ${g.total} 枚。内盘卖出其中 ${g.curve} 枚，每次买入都会推高价格。买家向内盘投入 ${g.sol} SOL 后，代币毕业：Raydium 把这 ${g.sol} SOL（如果收取迁移费，则扣除迁移费）和剩下的 ${g.migrate} 枚代币转入一个新的 Raydium 池子。按今天的 SOL 价格，这相当于约 ${g.cap} 的市值。此后代币就在池子里交易。`,
    step8Title: "池子的流动性永久锁定，而不是销毁",
    step8Body: (sol: number) =>
      `池子的全部流动性都用 Raydium Burn & Earn 锁定，它没有任何提取的方法。谁都不能把这 ${sol} SOL 从池子里取出来，${BRAND} 也不能。对持有人来说，这和销毁一样安全，只有一点不同：锁定的流动性会继续赚取池子的交易手续费，这些手续费会继续用来分红。销毁的流动性什么也赚不到。`,
    step9Title: (total: string) => `毕业后手续费降到 ${total}`,
    step9Body: (a: AfterGrad) =>
      `在 Raydium 池子里交易支付 ${a.total}，而不是 ${a.trade}：池子的 ${a.pool} 交易手续费，加上 ${a.creatorFee} 的创建者手续费。Raydium 拿走 ${a.pool} 中的 ${a.raydiumPool}% 和创建者手续费中的 ${a.raydiumCreator}%，其余部分由锁定的流动性赚取。${BRAND} 把这部分和创建者手续费的其余部分一起收取，再分配：${a.holders} 给持有人，${a.creator} 给创建者，${a.divvy} 给 ${BRAND}。分红照样每小时都有，只是每交易一美元分到的更少。`,
    feesTitle: "手续费去向",
    feesSub: "每交易 $1,000",
    colCurve: "内盘",
    colAfter: "毕业后",
    rowTrader: "交易者支付",
    rowHolders: "持有人分红",
    rowCreator: "创建者",
    rowLiquidity: "流动性",
    liqCurve: "在内盘中",
    liqLocked: "永久锁定",
    fine1: "股票代币由 xStocks 等第三方发行。它们跟踪股票价格，但不带投票权，在一些国家（包括美国）可能无法使用。",
    fine2: "股票代币全天候交易，而真实股市在夜间和周末休市，所以股市重新开盘时，股票代币的价格可能跳动。",
    fine3: `毕业后，锁定流动性赚取的手续费有一半是代币本身，${BRAND} 会在分红前把它们卖成 SOL。毕业后的数字经过四舍五入，可能随 Raydium 的池子设置变动几美分。`,
    fine4: "大多数新代币永远不会毕业。分红完全取决于交易额。本页内容不构成投资建议。",
    createCoin: "创建代币",
  },
);
