# "uspad is live" video for X

Video: `uspad-live-1920x1080.mp4` (16:9, 42 s, 30 fps, H.264, AAC 192k at -14 LUFS).

How it's made (repo root):
1. Start the site in demo mode (mock API on :4000, `next start` on :3000) and take the product shots:
   `node brand/uspad/src/live-shots.cjs http://localhost:3000 brand/uspad/social/live-shots <coin picture.png>`
2. `node brand/uspad/src/live-video.cjs brand/uspad` (`--stills <dir>` for one frame per scene).
3. `python3 brand/uspad/src/live-music.py brand/uspad` (the soundtrack; needs numpy and ffmpeg).

The shots are the real interface with the demo's sample data, and the video says so on every window
("Interface preview, sample data") and in the closing line. Every uspad fact matches the How it works
page. Post it once launches are open to everyone (`go-live.sh launches open`).

Scenes: the logo and "uspad is live." → launching a coin → "$MOONCAT is live" → the candlestick chart
and the trade box → hourly payouts in stock tokens → the 1% split and graduation → "Launchpad open to
the public."

## Post (under 280 characters)

```text
uspad is live. 🟢

The launchpad is open to everyone: launch a Solana memecoin and its holders get paid in US stocks, every hour.

No snipers. No dev buy. Liquidity locked forever.

Launch yours → uspad.fun
```

## Long post

```text
uspad is live on Solana. 🟢

The launchpad is open to the public. Launch a memecoin, pick the stock it pays, and its holders get that stock every hour.

• NVDAx, SPYx, TSLAx and more
• Private launch: no snipers, no dev buy
• Live candlestick chart, buy and sell on uspad
• 1% per trade, half of it to holders
• Liquidity locked forever at graduation

Launch yours → uspad.fun
```

## Versi Indonesia

```text
uspad sudah live. 🟢

Launchpad kini terbuka untuk umum: launch memecoin di Solana, dan holder-nya dibayar dengan saham Amerika setiap jam.

Tanpa sniper. Tanpa dev buy. Likuiditas dikunci selamanya.

Launch sekarang → uspad.fun
```
