import Link from "next/link";
import { bpsLabel, usd, type Config } from "@divvy/shared";
import { api } from "@/lib/api";

const pctLabel = (bps: number) => `${+(bps / 100).toFixed(2)}%`;

export default async function HowPage() {
  const c = await api<Config>("/api/config");
  const f = c.fees;
  return (
    <>
      <h1 className="page-h">How Divvy works</h1>
      <p className="page-lede">A memecoin you buy with SOL. A dividend you&apos;re paid in a real stock token. Here&apos;s the path from a form to a payout.</p>
      <ol className="steps">
        <li>
          <span className="n">1</span>
          <div>
            <h3>You fill in the form</h3>
            <p>Name, ticker, picture and the stock your holders will earn: NVDAx, SPYx, TSLAx and the rest. Launching costs nothing. The stock is locked once the coin is live.</p>
          </div>
        </li>
        <li>
          <span className="n">2</span>
          <div>
            <h3>Copies are refused</h3>
            <p>The ticker has to be new here, with case, spaces, lookalike letters and leetspeak folded into one. Names with “official” or a “2” tacked on, resized or recolored pictures, and a second coin from the same X account are all turned away, with the reason.</p>
          </div>
        </li>
        <li>
          <span className="n">3</span>
          <div>
            <h3>The launcher creates it in a private bundle</h3>
            <p>Divvy&apos;s launcher wallet creates the coin on a Raydium LaunchLab bonding curve and pays the rent. The create goes out as a private bundle and the address isn&apos;t shown before it lands, so nobody can buy in the block it&apos;s created in. There&apos;s no dev buy for anyone.</p>
          </div>
        </li>
        <li>
          <span className="n">4</span>
          <div>
            <h3>Every trade fills the coin&apos;s vault</h3>
            <p>
              Trades pay a {pctLabel(f.tradeFeeBps)} fee on chain, straight into this coin&apos;s own vault: {bpsLabel(f.holdersBps)} for holders, {bpsLabel(f.creatorBps)} for the creator, {bpsLabel(f.divvyBps)} for Divvy and {bpsLabel(f.protocolBps)} for Raydium. Nothing is forwarded by hand and nothing is estimated.
            </p>
          </div>
        </li>
        <li>
          <span className="n">5</span>
          <div>
            <h3>Holders are paid every hour</h3>
            <p>
              At the top of each hour the vault buys the coin&apos;s stock token and sends it to every wallet holding at least {usd(c.payouts.minHolderUsd)}, in proportion to what they hold. The curve, the pool and the launcher wallet are left out. Each round is a receipt on the payouts page, and a round more than {Math.round(c.payouts.lateAfterSec / 60)} minutes late turns red.
            </p>
          </div>
        </li>
      </ol>
      <div className="fine">
        <p>Tokenized stocks are issued by third parties such as xStocks. They track a share&apos;s price but carry no voting rights, and may be unavailable in some countries, including the United States.</p>
        <p>A stock token trades around the clock while the real market closes at night and on weekends, so its price can jump when the market reopens.</p>
        <p>Most new coins never graduate. Payouts depend entirely on trading volume. Nothing here is financial advice.</p>
      </div>
      <div style={{ marginBottom: 80 }}>
        <Link className="btn btn-g btn-lg" href="/create">Create a coin</Link>
      </div>
    </>
  );
}
