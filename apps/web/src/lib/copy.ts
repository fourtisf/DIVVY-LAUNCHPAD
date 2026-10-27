import { usd, type Config } from "@divvy/shared";

/**
 * Copy that depends on the owner's delivery decision (HANDOFF §3.4). With "push" the prototype's
 * wording stays exactly as approved; with "claim" the hero lede, how-it-works step 5, the dividend
 * card note and the payouts lede say "credited" instead of "paid".
 *
 * Holders pay their own delivery (owner decision 2026-10-27), so how-it-works says what a send keeps.
 */
export function deliveryCopy(c: Pick<Config, "payouts">) {
  const claim = c.payouts.delivery === "claim";
  const fee = c.payouts.deliveryFeeUsd > 0 ? usd(c.payouts.deliveryFeeUsd) : null;
  return {
    claim,
    heroTail: claim ? "and credits it to holders every hour." : "and splits it between holders every hour.",
    howStepTitle: claim ? "Holders are credited every hour" : "Holders are paid every hour",
    howStepVerb: claim ? "credits it to" : "sends it to",
    howStepExtra: claim
      ? ` Wallets that already hold the stock token get it sent automatically${fee ? `, less a ${fee} fee` : ""}; everyone else claims it any time.`
      : `${fee ? ` Each send keeps a ${fee} fee from the dividend, and a` : " A"} wallet's first send also pays the rent of its new stock token account, which the wallet gets back if it ever closes that account.`,
    cardNoteVerb: claim ? "credited" : "paid",
    payoutsLedeVerb: claim ? "credits it to" : "sends it to",
  };
}
