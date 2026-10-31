import Link from "next/link";
import { bpsLabel, usd, type Config } from "@divvy/shared";
import { sharedApi } from "@/lib/server-api";
import { deliveryCopy } from "@/lib/copy";
import { BRAND } from "@/lib/brand";
import { getLang, getMsgs } from "@/i18n/server";
import { how } from "@/i18n/msgs/how";
import { POOL_CREATOR_FEE_BPS, POOL_CREATOR_RAYDIUM_SHARE, POOL_FEE_BPS, POOL_RAYDIUM_SHARE, poolFees } from "@/lib/poolfees";

const pctLabel = (bps: number) => `${+(bps / 100).toFixed(2)}%`;
const tokens = (v: number) => (v >= 1e9 ? `${+(v / 1e9).toFixed(2)}B` : `${+(v / 1e6).toFixed(1)}M`);
const usdShort = (v: number) => (v >= 1e6 ? `$${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);
/** Dollars per $1,000 traded for a fee in basis points. */
const per1k = (bps: number) => `$${(bps / 10).toFixed(2)}`;

export default async function HowPage() {
  const [c, t, lang] = await Promise.all([sharedApi<Config>("/api/config"), getMsgs(how), getLang()]);
  const f = c.fees;
  const g = c.graduation;
  const raiseSol = +g.quoteFundRaising.ui.toFixed(1);
  const copy = deliveryCopy(c, lang);

  const w = f.afterGraduation;
  const shared = w.holders + w.creator + w.divvy;
  const share = (v: number) => `${Math.round((v / shared) * 100)}%`;
  const after = poolFees(w);

  return (
    <>
      <h1 className="page-h">{t.title}</h1>
      <p className="page-lede">{t.lede}</p>
      <ol className="steps">
        <li>
          <span className="n">1</span>
          <div>
            <h3>{t.step1Title}</h3>
            <p>{t.step1Body(c.launchFee.to ? t.launchCostFee(c.launchFee.amount.ui, c.launchFee.createCost.ui) : c.launchFee.createCost.ui ? t.launchCostCreate(c.launchFee.createCost.ui) : t.launchFree)}</p>
          </div>
        </li>
        <li>
          <span className="n">2</span>
          <div>
            <h3>{t.step2Title}</h3>
            <p>{t.step2Body}</p>
          </div>
        </li>
        <li>
          <span className="n">3</span>
          <div>
            <h3>{t.step3Title}</h3>
            <p>{t.step3Body}</p>
          </div>
        </li>
        <li>
          <span className="n">4</span>
          <div>
            <h3>{t.step4Title(pctLabel(f.tradeFeeBps))}</h3>
            <p>
              {t.step4Body({ holders: bpsLabel(f.holdersBps), creator: bpsLabel(f.creatorBps), divvy: bpsLabel(f.divvyBps), protocol: bpsLabel(f.protocolBps) })}
            </p>
          </div>
        </li>
        <li>
          <span className="n">5</span>
          <div>
            <h3>{t.step5Title(bpsLabel(f.protocolBps))}</h3>
            <p>{t.step5Body(bpsLabel(f.protocolBps), pctLabel(f.tradeFeeBps))}</p>
          </div>
        </li>
        <li>
          <span className="n">6</span>
          <div>
            <h3>{copy.howStepTitle}</h3>
            <p>
              {t.step6Body({ verb: copy.howStepVerb, extra: copy.howStepExtra, min: usd(c.payouts.minHolderUsd), lateMin: Math.round(c.payouts.lateAfterSec / 60) })}
            </p>
          </div>
        </li>
        <li>
          <span className="n">7</span>
          <div>
            <h3>{t.step7Title(raiseSol)}</h3>
            <p>
              {t.step7Body({ total: tokens(g.totalSupply.ui), curve: tokens(g.curveSupply.ui), migrate: tokens(g.migrateSupply.ui), sol: raiseSol, cap: usdShort(g.targetUsd) })}
            </p>
          </div>
        </li>
        <li>
          <span className="n">8</span>
          <div>
            <h3>{t.step8Title}</h3>
            <p>
              {t.step8Body(raiseSol)}
            </p>
          </div>
        </li>
        <li>
          <span className="n">9</span>
          <div>
            <h3>{t.step9Title(bpsLabel(after.total))}</h3>
            <p>
              {t.step9Body({
                total: bpsLabel(after.total),
                trade: pctLabel(f.tradeFeeBps),
                pool: pctLabel(POOL_FEE_BPS),
                creatorFee: pctLabel(POOL_CREATOR_FEE_BPS),
                raydiumPool: Math.round(POOL_RAYDIUM_SHARE * 100),
                raydiumCreator: Math.round(POOL_CREATOR_RAYDIUM_SHARE * 100),
                holders: share(w.holders),
                creator: share(w.creator),
                divvy: share(w.divvy),
              })}
            </p>
          </div>
        </li>
      </ol>
      <div className="sec-h">
        <div>
          <h2>{t.feesTitle}</h2>
          <p>{t.feesSub}</p>
        </div>
      </div>
      <div className="how-fees">
        <table className="t">
          <thead>
            <tr>
              <th />
              <th className="r">{t.colCurve}</th>
              <th className="r">{t.colAfter}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t.rowTrader}</td>
              <td className="r">{per1k(f.tradeFeeBps)} ({pctLabel(f.tradeFeeBps)})</td>
              <td className="r">{per1k(after.total)} ({bpsLabel(after.total)})</td>
            </tr>
            <tr>
              <td>{t.rowHolders}</td>
              <td className="r"><b>{per1k(f.holdersBps)}</b></td>
              <td className="r"><b>{per1k(after.holders)}</b></td>
            </tr>
            <tr>
              <td>{t.rowCreator}</td>
              <td className="r">{per1k(f.creatorBps)}</td>
              <td className="r">{per1k(after.creator)}</td>
            </tr>
            <tr>
              <td>{BRAND}</td>
              <td className="r">{per1k(f.divvyBps)}</td>
              <td className="r">{per1k(after.divvy)}</td>
            </tr>
            <tr>
              <td>Raydium</td>
              <td className="r">{per1k(f.protocolBps)}</td>
              <td className="r">{per1k(after.raydium)}</td>
            </tr>
            <tr>
              <td>{t.rowLiquidity}</td>
              <td className="r">{t.liqCurve}</td>
              <td className="r">{t.liqLocked}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="fine">
        <p>{t.fine1}</p>
        <p>{t.fine2}</p>
        <p>{t.fine3}</p>
        <p>{t.fine4}</p>
      </div>
      <div style={{ marginBottom: 80 }}>
        <Link className="btn btn-g btn-lg" href="/create">{t.createCoin}</Link>
      </div>
    </>
  );
}
