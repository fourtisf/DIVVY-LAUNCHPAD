# Chinese and English copy

hwai is Chinese first (owner, 2026-10-31): the site opens in Simplified Chinese and the 中 / EN switch in
the header changes the language for the whole site. The choice lives in the `lang` cookie, so the server
renders the right language on the first request. The footer's up/down switch (`updown` cookie) picks
red up (the default since design A, as Chinese stock apps show it) or green up.

## How copy is written

- Each area has a file in `msgs/` that calls `defineMsgs(en, zh)`. `zh` must have exactly `en`'s shape,
  so a missing translation fails `pnpm typecheck`.
- Client components: `const t = useMsgs(area)` from `@/i18n/client`. Server components:
  `const t = await getMsgs(area)` from `@/i18n/server`. Relative times: `useAgo()`.
- A message is a string, or a function when it takes values (`(n: number) => string`). A sentence with
  a link or bold part is a function returning JSX in a `.tsx` message file, so the word order can differ.
- The product name comes from `BRAND` (`@/lib/brand`), never typed out.
- English copy keeps the prototype's wording (CLAUDE.md rule 8). The e2e tests read the English copy.
- Admin pages stay English. Coin names, tickers and other things users type are never translated.

## Chinese style

- Simplified Chinese with full-width punctuation in Chinese sentences (，。：？！（）).
- A space between Han characters and Latin letters or digits: `5 分钟前`, `持有 $10 以上`, `Solana 发币`.
- Short, plain sentences. No hype words, no exclamation marks.
- Numbers, `$` amounts, SOL, tickers and stock symbols (NVDAx) stay as they are.

## Glossary

| English | 中文 |
|---|---|
| coin, memecoin | 代币 (土狗 only in the playful hero line) |
| holder(s) | 持有人 |
| dividend, payout | 分红 |
| payout round | 一轮分红 / 分红轮次 |
| paid every hour / credited every hour | 每小时分红 / 每小时记入 |
| tokenized stock, stock token | 股票代币 |
| US stocks | 美股 |
| pays in (the stock a coin pays) | 分红资产 |
| bonding curve | 内盘 |
| graduate, graduated | 毕业, 已毕业 |
| Raydium pool (after graduation) | Raydium 池子 |
| market cap | 市值 |
| 24h volume | 24 小时交易额 |
| create a coin, launch | 创建代币, 发币 |
| launched | 上线 |
| creator | 创建者 |
| dev buy | 开发者首买 |
| contract address, CA, mint | 合约地址 (CA) |
| ticker | 代币符号 |
| wallet, connect wallet | 钱包, 连接钱包 |
| sign (a transaction) | 签名 |
| transaction | 交易 |
| buy, sell, trade | 买入, 卖出, 交易 |
| slippage | 滑点 |
| priority fee | 优先费 |
| Jito bundle | Jito 捆绑交易 |
| fee, trading fee | 手续费, 交易手续费 |
| creator fees | 创建者手续费 |
| claim | 领取 |
| copy (of another coin), vamp | 仿盘 |
| sniper, block 0 | 狙击, 0 号区块 |
| on chain | 链上 |
| report | 举报 |
| moderators | 管理员 |
| terms | 条款 |
| not financial advice | 不构成投资建议 |
