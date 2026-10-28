# "$USPAD is live" video for X

Video: `uspad-token-1920x1080.mp4` (16:9, 44 s, 30 fps with film motion blur, H.264, AAC 192k at -14 LUFS).
Shot like a trailer, letterboxed, so it looks nothing like the launch videos: the $USPAD coin in 3D
(`token3d.ts`) and the live site cut into glass panels floating in depth.

It names the ticker only: no contract address anywhere (owner request 2026-10-28). The closing line sends
people to @uspadfun for $USPAD's address, because tickers can repeat on uspad and the board shows more
than one $USPAD.

How it's made (repo root):
1. Screenshots of the live site in `token-shots/`, with every address painted over: the board's hero
   (the "CA" pill) and the coin page (its address chip, the chips after it moved left). The owner took
   them on 2026-10-28 (this environment can't reach uspad.fun); `token-shots.cjs` takes the same set
   with the addresses hidden when the site is reachable.
2. `node brand/uspad/src/token-video.cjs brand/uspad` (`--stills <dir>` for one frame per scene). It
   bundles `token3d.ts` with esbuild and renders every frame twice for the motion blur: about 50 minutes
   without a GPU.
3. `python3 brand/uspad/src/token-music.py brand/uspad` (the score; needs numpy and ffmpeg).

The shots are real data at that moment, so the panels show live numbers, not sample data.

Scenes (0 to 44 s, on the bars of the score):
- 0 s: a macro pass along the coin's reeded rim in the dark, "uspad.fun presents".
- 6 s: the coin turns to face the camera under a sweeping light; "$USPAD is live." decodes letter by letter.
- 12 s: the letterbox opens into a flight through the live site, one station every 4 s:
  01 the board ("Every coin, live."), 02 a coin page's chart and trade box ("Chart it. Trade it."),
  03 its holders and where the fee goes ("See who gets paid."), 04 the payouts page ("Every payout, on chain.").
- 28 s: the six stock coins orbit $USPAD: "Every coin pays its holders in US stocks, every hour."
- 34 s: the fee as a ring: 1.25% on every trade, split four ways.
- 38 s: $USPAD, uspad.fun, @uspadfun and t.me/uspadfun, and the fine print.

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
