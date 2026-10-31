import type { Metadata } from "next";
import { bpsLabel, type Config } from "@divvy/shared";
import { sharedApi } from "@/lib/server-api";
import { getMsgs } from "@/i18n/server";
import { terms } from "@/i18n/msgs/terms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMsgs(terms)).metaTitle };
}

/**
 * Terms of use. The wording is a starting point for the owner's lawyers (HANDOFF §10), not final
 * legal text; the draft notice stays until NEXT_PUBLIC_TERMS_FINAL=true.
 */
export default async function TermsPage() {
  const [c, t] = await Promise.all([sharedApi<Config>("/api/config"), getMsgs(terms)]);
  const draft = process.env.NEXT_PUBLIC_TERMS_FINAL !== "true";
  return (
    <article className="terms">
      <h1 className="page-h">{t.title}</h1>
      {draft && <p className="note terms-draft">{t.draft}</p>}
      {/* Chinese only: the English version prevails. */}
      {t.prevails && <p className="note">{t.prevails}</p>}
      <h3>{t.whatTitle}</h3>
      <p>
        {t.whatBody(c.payouts.delivery === "claim")}
      </p>
      <h3>{t.stocksTitle}</h3>
      <p>
        {t.stocksBody}
      </p>
      <h3>{t.riskTitle}</h3>
      <p>
        {t.riskBody}
      </p>
      <h3>{t.feesTitle}</h3>
      <p>
        {t.feesBody({ trade: c.fees.tradeFeeBps / 100, holders: bpsLabel(c.fees.holdersBps), creator: bpsLabel(c.fees.creatorBps), divvy: bpsLabel(c.fees.divvyBps), protocol: bpsLabel(c.fees.protocolBps) })}
      </p>
      <h3>{t.moderationTitle}</h3>
      <p>{t.moderationBody}</p>
      <h3>{t.dataTitle}</h3>
      <p>{t.dataBody}</p>
    </article>
  );
}
