import { BRAND } from "../../lib/brand";
import { defineMsgs } from "../lang";

/**
 * Wallet and transaction errors (lib/tx.ts, lib/txcheck.ts), shown through errorText (lib/session.tsx).
 * The API's own error messages come back in English and are shown as they are.
 */
export const txErrors = defineMsgs(
  {
    sentUnconfirmed: "Sent. Confirmation is taking a while; check the explorer before trying again.",
    expired: "The transaction didn't land in time. Nothing was spent; try again.",
    failedOnChain: "The transaction failed on chain. Only the network fee was spent.",
    unsafe: (reason: string) => `${BRAND} stopped this transaction before your wallet saw it: ${reason}.`,
    noWallet: "Connect a wallet first",
    cantSign: "This wallet can't sign transactions",
  },
  {
    sentUnconfirmed: "已发送，确认需要一点时间。重试之前先在区块浏览器上查看。",
    expired: "交易没能及时上链。没有花费任何资金，请重试。",
    failedOnChain: "交易在链上失败了。只花了网络手续费。",
    // The reason is a technical detail from the transaction check and stays in English.
    unsafe: (reason: string) => `${BRAND} 在你的钱包看到这笔交易之前拦下了它：${reason}。`,
    noWallet: "请先连接钱包",
    cantSign: "这个钱包不能签名交易",
  },
);
