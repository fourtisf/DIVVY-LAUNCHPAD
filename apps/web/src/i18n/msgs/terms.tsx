import { BRAND } from "@/lib/brand";
import { defineMsgs } from "../lang";

type CurveSplit = { trade: number; holders: string; creator: string; divvy: string; protocol: string };

/**
 * Terms of use (app/terms/page.tsx). A draft for the owner's lawyers (HANDOFF §10). The Chinese text
 * adds one line saying the English version prevails; in English that line is empty and not rendered.
 */
export const terms = defineMsgs(
  {
    metaTitle: `Terms · ${BRAND}`,
    title: "Terms of use",
    draft: `Draft. These terms are waiting for legal review and will change before ${BRAND} opens on mainnet.`,
    prevails: "",
    whatTitle: `What ${BRAND} is`,
    whatBody: (claim: boolean) =>
      `${BRAND} is software for launching memecoins on Raydium LaunchLab. Each coin trades against SOL. Part of every trade fee buys a tokenized stock, such as NVDAx or SPYx, which is ${claim ? "credited" : "sent"} to holders every hour. Nothing on ${BRAND} is financial, legal or tax advice.`,
    stocksTitle: "Tokenized stocks",
    stocksBody: `Tokenized stocks are issued by third parties such as xStocks. They track a share's price but aren't shares: they carry no voting rights and no claim on the company. Their issuers can pause them. They aren't available in some countries, including the United States, and ${BRAND} refuses launches and claims from places where they aren't allowed.`,
    riskTitle: "Risk",
    riskBody: "Memecoins are volatile and can go to zero. Payouts depend on trading volume and can be small or nothing. Transactions on Solana can't be reversed. You are responsible for your wallet, your keys and the transactions you sign.",
    feesTitle: "Fees",
    feesBody: (s: CurveSplit) =>
      `Trades pay ${s.trade}% on the bonding curve: ${s.holders} for holders, ${s.creator} for the coin's creator, ${s.divvy} for ${BRAND} and ${s.protocol} for Raydium. After a coin graduates it trades in a Raydium pool with that pool's fees.`,
    moderationTitle: "Moderation",
    moderationBody: `${BRAND} can pause launches and hide coins from its pages, for example coins that copy another coin, scams or illegal content. Hidden coins stay on chain and their holders keep getting their payouts.`,
    dataTitle: "Your data",
    dataBody: `${BRAND} stores your wallet address, a hashed session, and, if you link one, your X user id and handle. It doesn't store private keys or X access tokens.`,
  },
  {
    metaTitle: `条款 · ${BRAND}`,
    title: "使用条款",
    draft: `草案。本条款尚待法律审核，在 ${BRAND} 于主网上线之前还会修改。`,
    prevails: "本条款中英文版本如有不一致，以英文版本为准。",
    whatTitle: `${BRAND} 是什么`,
    whatBody: (claim: boolean) =>
      `${BRAND} 是在 Raydium LaunchLab 上发行代币的软件。每个代币都以 SOL 交易。每笔交易手续费的一部分用于买入股票代币，例如 NVDAx 或 SPYx，每小时${claim ? "记入" : "发给"}持有人。${BRAND} 上的任何内容都不构成投资、法律或税务建议。`,
    stocksTitle: "股票代币",
    stocksBody: `股票代币由 xStocks 等第三方发行。它们跟踪股票价格，但不是股票：不带投票权，也不享有对公司的任何权利。发行方可以暂停它们。一些国家（包括美国）不提供股票代币，在不允许使用股票代币的地区，${BRAND} 会拒绝发币和领取。`,
    riskTitle: "风险",
    riskBody: "代币价格波动大，可能归零。分红取决于交易额，可能很少，也可能没有。Solana 上的交易无法撤销。你要对自己的钱包、私钥和你签名的交易负责。",
    feesTitle: "手续费",
    feesBody: (s: CurveSplit) =>
      `内盘上的交易支付 ${s.trade}% 手续费：${s.holders} 给持有人，${s.creator} 给代币创建者，${s.divvy} 给 ${BRAND}，${s.protocol} 给 Raydium。代币毕业后在 Raydium 池子里交易，按该池子的手续费收取。`,
    moderationTitle: "内容管理",
    moderationBody: `${BRAND} 可以暂停发币，也可以在页面上隐藏代币，例如仿盘、骗局或违法内容。被隐藏的代币仍在链上，持有人照常获得分红。`,
    dataTitle: "你的数据",
    dataBody: `${BRAND} 保存你的钱包地址、经过哈希处理的会话，以及（如果你关联了 X 账号）你的 X 用户 ID 和用户名。${BRAND} 不保存私钥或 X 访问令牌。`,
  },
);
