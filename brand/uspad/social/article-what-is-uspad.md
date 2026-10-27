# X article: What is uspad, and how it works

Header image: `article-what-is-uspad-3000x1200.png` (5:2, as X recommends). Renderer: `brand/uspad/src/article.cjs`.
Every number matches the site's How it works page and docs/VERIFIED.md. The launch cost isn't mentioned until the owner decides on it.

---

**Title:** What is uspad, and how it works

uspad is a memecoin launchpad on Solana with one twist: every coin pays its holders a dividend in a tokenized US stock, every hour. Hold a coin that pays in NVDAx, and you're paid in NVDAx.

## The idea

Memecoins are fun to trade, but holding one pays nothing. On uspad, every trade funds a dividend in real stock tokens for the people who hold the coin.

## 1. Launching a coin

- Pick a name, a ticker, a picture, and the stock your holders will earn: NVDAx, SPYx, TSLAx, AAPLx, QQQx, GOOGLx, AMZNx, MSTRx, COINx, HOODx or CRCLx. The stock is fixed once the coin is live.
- Copies are refused. A ticker has to be new on uspad, with case, spaces, lookalike letters and leetspeak folded together. Recycled pictures and a second coin from the same X account are turned away too.
- uspad's launcher creates the coin on a Raydium LaunchLab bonding curve, in a private Jito bundle. Its address isn't public before it lands, so nobody can buy in the block it's created in. There is no dev buy and no team allocation: the whole supply goes to the curve and the pool.

## 2. Where the trading fee goes

Every buy and sell on the bonding curve pays 1%:

- 0.50% to the coin's holders, as their dividend
- 0.15% to the coin's creator
- 0.10% to uspad
- 0.25% to Raydium, whose LaunchLab program runs the curve

Each coin's share is counted from its own on-chain trades, so a coin's dividend is exactly what its own trading paid.

## 3. Getting paid every hour

At the top of every hour, the holders' share buys the coin's stock token and sends it to every wallet holding at least $10 of the coin, in proportion to what it holds.

- A wallet's balance counts as the smaller of a random moment in the middle of the hour and the moment of the payout, so buying a minute before the hour and selling right after doesn't work.
- The bonding curve, the pool and uspad's own wallets are left out.
- Holders pay their own delivery: each send keeps a $0.02 fee from the dividend, and a wallet's first send of a stock also covers the rent of its new stock token account (about 0.002 SOL), which the wallet gets back if it ever closes that account.
- Every round is a public receipt on uspad.fun.

## 4. Graduation

Every coin has 1 billion tokens. The bonding curve sells 793.1 million of them, and the price rises with each buy. When buyers have put 85 SOL into the curve (a market cap of about 410 SOL), the coin graduates: the 85 SOL and the remaining 206.9 million tokens move into a Raydium pool.

The pool's liquidity is locked forever with Raydium Burn & Earn. There is no way to withdraw it: nobody can pull it, uspad included. Unlike burned liquidity, locked liquidity keeps earning the pool's trading fees, and those keep paying holders.

## 5. After graduation

A trade in the Raydium pool pays 0.30% instead of 1%: the pool's 0.25% fee plus a 0.05% creator fee. Raydium keeps 16% of the pool fee and 5% of the creator fee. The rest goes to uspad and is split the same way as on the curve: 50 : 15 : 10 between holders, the creator and uspad.

Per $1,000 traded after graduation: holders $1.72, creator $0.52, uspad $0.34, Raydium $0.42. Dividends keep coming every hour, just smaller per dollar traded.

## Why it's built this way

- Fair launches: private bundles, no dev buy, no copycats.
- Yield in real assets: dividends are tokenized stocks, not points.
- Liquidity that can't be pulled.
- Everything on chain and checkable: fees, payouts and receipts.

## Good to know

- Tokenized stocks (xStocks) are issued by third parties. They track a share's price, carry no voting rights, and aren't available to US persons or in some other countries.
- Stock tokens trade around the clock while stock markets close at night and on weekends, so their price can jump when the market reopens.
- Most new coins never graduate, and payouts depend entirely on trading volume. Nothing here is financial advice.

## What's next

uspad is launching soon on Solana. The official contract address will only be posted on uspad.fun and @uspadfun. Anything else is fake.

Follow @uspadfun.
