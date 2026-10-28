# "$USPAD is live" video for X

Video: `uspad-token-1920x1080.mp4` (16:9, 48 s, 30 fps with film motion blur, H.264, AAC 192k at -14 LUFS).

It names the ticker only: no contract address anywhere (owner request 2026-10-28). The closing line sends
people to @uspadfun for $USPAD's address, because tickers can repeat on uspad and the board shows more
than one $USPAD.

How it's made (repo root):
1. Screenshots of the live site in `token-shots/`, with every address painted over: the board's hero
   (the "CA" pill) and the coin page (its address chip, the chips after it moved left). The owner took
   them on 2026-10-28 (this environment can't reach uspad.fun); `token-shots.cjs` takes the same set
   with the addresses hidden when the site is reachable.
2. `node brand/uspad/src/token-video.cjs brand/uspad` (`--stills <dir>` for one frame per scene).
3. `python3 brand/uspad/src/token-music.py brand/uspad` (the soundtrack; needs numpy and ffmpeg).

The shots are real data at that moment, so the windows say "Live on uspad.fun", not "sample data".

Scenes: the Koin belah mark → "$USPAD is live." over the 3D coins → "Inside uspad.fun" → the board
(every coin live, sorts and search) → a coin page (the candlestick chart and the trade box) → its
holders and where the fee goes → holders paid in US stocks, every hour → the payouts page (a receipt
for every round) → every trade pays 1.25%, split four ways → "Trade $USPAD." uspad.fun.

## Post (under 280 characters as X counts them)

```text
$USPAD is live. 🟢

The token of uspad.fun, the launchpad where every memecoin pays its holders in tokenized US stocks, every hour.

Get the official contract address from @uspadfun only: tickers can repeat.

Trade it → uspad.fun
```

## Versi Indonesia

```text
$USPAD sudah live. 🟢

Token dari uspad.fun, launchpad tempat setiap memecoin membayar holder-nya dengan saham AS tokenisasi, setiap jam.

Ambil CA resmi hanya dari @uspadfun: ticker bisa sama.

Trade → uspad.fun
```
