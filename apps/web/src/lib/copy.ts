import type { Config } from "@divvy/shared";

/**
 * Copy that depends on the owner's delivery decision (HANDOFF §3.4). With "push" the prototype's
 * wording stays exactly as approved; with "claim" the hero lede, how-it-works step 5, the dividend
 * card note and the payouts lede say "credited" instead of "paid".
 */
export function deliveryCopy(c: Pick<Config, "payouts">) {
  const claim = c.payouts.delivery === "claim";
  return {
    claim,
    heroTail: claim ? "and credits it to holders every hour." : "and splits it between holders every hour.",
    howStepTitle: claim ? "Holders are credited every hour" : "Holders are paid every hour",
    howStepVerb: claim ? "credits it to" : "sends it to",
    howStepExtra: claim ? " Wallets that already hold the stock token get it sent automatically; everyone else claims it any time." : "",
    cardNoteVerb: claim ? "credited" : "paid",
    payoutsLedeVerb: claim ? "credits it to" : "sends it to",
  };
}
