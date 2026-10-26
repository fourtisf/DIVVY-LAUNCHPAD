import type { Metadata } from "next";
import type { Config } from "@divvy/shared";
import { api } from "@/lib/api";

export const metadata: Metadata = { title: "Terms · Divvy" };

/**
 * Terms of use. The wording is a starting point for the owner's lawyers (HANDOFF §10), not final
 * legal text; the draft notice stays until NEXT_PUBLIC_TERMS_FINAL=true.
 */
export default async function TermsPage() {
  const c = await api<Config>("/api/config");
  const draft = process.env.NEXT_PUBLIC_TERMS_FINAL !== "true";
  return (
    <article className="terms">
      <h1 className="page-h">Terms of use</h1>
      {draft && <p className="note terms-draft">Draft. These terms are waiting for legal review and will change before Divvy opens on mainnet.</p>}
      <h3>What Divvy is</h3>
      <p>
        Divvy is software for launching memecoins on Raydium LaunchLab. Each coin trades against SOL. Part of every trade fee buys a tokenized stock, such as NVDAx or SPYx, which is {c.payouts.delivery === "claim" ? "credited" : "sent"} to holders every hour. Nothing on Divvy is financial, legal or tax advice.
      </p>
      <h3>Tokenized stocks</h3>
      <p>
        Tokenized stocks are issued by third parties such as xStocks. They track a share&apos;s price but aren&apos;t shares: they carry no voting rights and no claim on the company. Their issuers can pause them. They aren&apos;t available in some countries, including the United States, and Divvy refuses launches and claims from places where they aren&apos;t allowed.
      </p>
      <h3>Risk</h3>
      <p>
        Memecoins are volatile and can go to zero. Payouts depend on trading volume and can be small or nothing. Transactions on Solana can&apos;t be reversed. You are responsible for your wallet, your keys and the transactions you sign.
      </p>
      <h3>Fees</h3>
      <p>
        Trades pay {c.fees.tradeFeeBps / 100}% on the bonding curve: {c.fees.holdersBps / 100}% for holders, {c.fees.creatorBps / 100}% for the coin&apos;s creator, {c.fees.divvyBps / 100}% for Divvy and {c.fees.protocolBps / 100}% for Raydium. After a coin graduates it trades in a Raydium pool with that pool&apos;s fees.
      </p>
      <h3>Moderation</h3>
      <p>Divvy can pause launches and hide coins from its pages, for example coins that copy another coin, scams or illegal content. Hidden coins stay on chain and their holders keep getting their payouts.</p>
      <h3>Your data</h3>
      <p>Divvy stores your wallet address, a hashed session, and, if you link one, your X user id and handle. It doesn&apos;t store private keys or X access tokens.</p>
    </article>
  );
}
