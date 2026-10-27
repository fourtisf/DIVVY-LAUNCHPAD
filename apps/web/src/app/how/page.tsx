import Link from "next/link";
import { bpsLabel, usd, type Config } from "@divvy/shared";
import { sharedApi } from "@/lib/server-api";
import { deliveryCopy } from "@/lib/copy";
import { POOL_CREATOR_FEE_BPS, POOL_CREATOR_RAYDIUM_SHARE, POOL_FEE_BPS, POOL_RAYDIUM_SHARE, poolFees } from "@/lib/poolfees";

const pctLabel = (bps: number) => `${+(bps / 100).toFixed(2)}%`;
const tokens = (v: number) => (v >= 1e9 ? `${+(v / 1e9).toFixed(2)}B` : `${+(v / 1e6).toFixed(1)}M`);
const usdShort = (v: number) => (v >= 1e6 ? `$${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);
/** Dollars per $1,000 traded for a fee in basis points. */
const per1k = (bps: number) => `$${(bps / 10).toFixed(2)}`;

export default async function HowPage() {
  const c = await sharedApi<Config>("/api/config");
  const f = c.fees;
  const g = c.graduation;
  const raiseSol = +g.quoteFundRaising.ui.toFixed(1);

  const w = f.afterGraduation;
  const shared = w.holders + w.creator + w.divvy;
  const share = (v: number) => `${Math.round((v / shared) * 100)}%`;
  const after = poolFees(w);

  return (
    <>
      <h1 className="page-h">How uspad works</h1>
      <p className="page-lede">A memecoin you buy with SOL. A dividend you&apos;re paid in a real stock token. Here&apos;s the path from a form to a payout.</p>
      <ol className="steps">
        <li>
          <span className="n">1</span>
          <div>
            <h3>You fill in the form</h3>
            <p>Name, ticker, picture and the stock your holders will earn: NVDAx, SPYx, TSLAx and the rest. {c.launchFee.to ? `Launching costs the ${c.launchFee.amount.ui} SOL fee and about ${c.launchFee.createCost.ui} SOL to create the coin, both in the one transaction your wallet signs: a launch that doesn't land costs nothing.` : c.launchFee.createCost.ui ? `Launching costs about ${c.launchFee.createCost.ui} SOL to create the coin, in the transaction your wallet signs.` : "Launching costs nothing."} The stock is locked once the coin is live.</p>
          </div>
        </li>
        <li>
          <span className="n">2</span>
          <div>
            <h3>Any name, any ticker</h3>
            <p>Coins can share a ticker, a name, a picture and an X account, so the contract address is what tells them apart. Every coin page shows it: check it against the address the project posts before you buy.</p>
          </div>
        </li>
        <li>
          <span className="n">3</span>
          <div>
            <h3>Your wallet creates it, in a private bundle</h3>
            <p>Your wallet signs and pays for the create on a Raydium LaunchLab bonding curve, so on chain and on explorers the coin is yours. The create goes out as a private bundle and the address isn&apos;t shown to anyone else before it lands, so nobody can buy in the block it&apos;s created in. There&apos;s no dev buy for anyone.</p>
          </div>
        </li>
        <li>
          <span className="n">4</span>
          <div>
            <h3>Every trade on the curve pays {pctLabel(f.tradeFeeBps)}</h3>
            <p>
              Raydium&apos;s LaunchLab program takes the fee on chain, on every buy and every sell: {bpsLabel(f.holdersBps)} for holders, {bpsLabel(f.creatorBps)} for the creator, {bpsLabel(f.divvyBps)} for uspad and {bpsLabel(f.protocolBps)} for Raydium. The creator&apos;s share goes straight to their own fee vault, and they claim it from their page. The holders&apos; and uspad&apos;s share goes to uspad&apos;s fee vault, and each trade&apos;s record says which coin paid it, so every coin&apos;s dividend is exactly what its own trades paid. Nothing is estimated.
            </p>
          </div>
        </li>
        <li>
          <span className="n">5</span>
          <div>
            <h3>Why Raydium gets {bpsLabel(f.protocolBps)}</h3>
            <p>The bonding curve and the pool after it are Raydium&apos;s programs, not uspad&apos;s. Raydium charges its own {bpsLabel(f.protocolBps)} on every curve trade for running them, and its own wallet moves the coin into the pool when it graduates. uspad can&apos;t turn that fee off and doesn&apos;t receive any of it. The {pctLabel(f.tradeFeeBps)} you see is the whole fee, Raydium&apos;s part included.</p>
          </div>
        </li>
        <li>
          <span className="n">6</span>
          <div>
            <h3>{deliveryCopy(c).howStepTitle}</h3>
            <p>
              At the top of each hour the vault buys the coin&apos;s stock token and {deliveryCopy(c).howStepVerb} every wallet holding at least {usd(c.payouts.minHolderUsd)}, in proportion to what they hold. The curve, the pool and the launcher wallet are left out.{deliveryCopy(c).howStepExtra} Each round is a receipt on the payouts page, and a round more than {Math.round(c.payouts.lateAfterSec / 60)} minutes late turns red.
            </p>
          </div>
        </li>
        <li>
          <span className="n">7</span>
          <div>
            <h3>At {raiseSol} SOL it graduates to a Raydium pool</h3>
            <p>
              Every coin has {tokens(g.totalSupply.ui)} tokens. The curve sells {tokens(g.curveSupply.ui)} of them, and the price rises with each buy. When buyers have put {raiseSol} SOL into the curve, the coin graduates: Raydium moves those {raiseSol} SOL, less its migration fee if it charges one, and the other {tokens(g.migrateSupply.ui)} tokens into a new Raydium pool. That&apos;s a market cap of about {usdShort(g.targetUsd)} at today&apos;s SOL price. From then on the coin trades in the pool.
            </p>
          </div>
        </li>
        <li>
          <span className="n">8</span>
          <div>
            <h3>The pool&apos;s liquidity is locked for good, not burned</h3>
            <p>
              All of the pool&apos;s liquidity is locked with Raydium Burn &amp; Earn, which has no way to withdraw it. Nobody can ever pull those {raiseSol} SOL out of the pool, uspad included. For holders that&apos;s as safe as burning it, with one difference: locked liquidity keeps earning the pool&apos;s trading fees, and those fees keep paying the dividend. Burned liquidity would earn nothing.
            </p>
          </div>
        </li>
        <li>
          <span className="n">9</span>
          <div>
            <h3>After graduation the fee drops to {bpsLabel(after.total)}</h3>
            <p>
              A trade in the Raydium pool pays {bpsLabel(after.total)} instead of {pctLabel(f.tradeFeeBps)}: the pool&apos;s {pctLabel(POOL_FEE_BPS)} trading fee plus a {pctLabel(POOL_CREATOR_FEE_BPS)} creator fee. Raydium keeps {Math.round(POOL_RAYDIUM_SHARE * 100)}% of the {pctLabel(POOL_FEE_BPS)} and {Math.round(POOL_CREATOR_RAYDIUM_SHARE * 100)}% of the creator fee, and the locked liquidity earns the rest. uspad collects that along with the rest of the creator fee and splits it: {share(w.holders)} to holders, {share(w.creator)} to the creator and {share(w.divvy)} to uspad. Dividends keep coming every hour, just smaller per dollar traded.
            </p>
          </div>
        </li>
      </ol>
      <div className="sec-h">
        <div>
          <h2>Where the fee goes</h2>
          <p>Per $1,000 traded</p>
        </div>
      </div>
      <div className="how-fees">
        <table className="t">
          <thead>
            <tr>
              <th />
              <th className="r">On the curve</th>
              <th className="r">After graduation</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>The trader pays</td>
              <td className="r">{per1k(f.tradeFeeBps)} ({pctLabel(f.tradeFeeBps)})</td>
              <td className="r">{per1k(after.total)} ({bpsLabel(after.total)})</td>
            </tr>
            <tr>
              <td>Holders&apos; dividend</td>
              <td className="r"><b>{per1k(f.holdersBps)}</b></td>
              <td className="r"><b>{per1k(after.holders)}</b></td>
            </tr>
            <tr>
              <td>Creator</td>
              <td className="r">{per1k(f.creatorBps)}</td>
              <td className="r">{per1k(after.creator)}</td>
            </tr>
            <tr>
              <td>uspad</td>
              <td className="r">{per1k(f.divvyBps)}</td>
              <td className="r">{per1k(after.divvy)}</td>
            </tr>
            <tr>
              <td>Raydium</td>
              <td className="r">{per1k(f.protocolBps)}</td>
              <td className="r">{per1k(after.raydium)}</td>
            </tr>
            <tr>
              <td>Liquidity</td>
              <td className="r">In the curve</td>
              <td className="r">Locked for good</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="fine">
        <p>Tokenized stocks are issued by third parties such as xStocks. They track a share&apos;s price but carry no voting rights, and may be unavailable in some countries, including the United States.</p>
        <p>A stock token trades around the clock while the real market closes at night and on weekends, so its price can jump when the market reopens.</p>
        <p>After graduation, half of the locked liquidity&apos;s fees arrive in the coin itself, and uspad sells them for SOL before the payout. The figures after graduation are rounded and can move by a few cents with Raydium&apos;s pool settings.</p>
        <p>Most new coins never graduate. Payouts depend entirely on trading volume. Nothing here is financial advice.</p>
      </div>
      <div style={{ marginBottom: 80 }}>
        <Link className="btn btn-g btn-lg" href="/create">Create a coin</Link>
      </div>
    </>
  );
}
