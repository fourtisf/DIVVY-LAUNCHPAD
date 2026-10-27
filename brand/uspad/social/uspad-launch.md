# "Anyone can launch" video for X

Video: `uspad-launch-1920x1080.mp4` (16:9, 48 s, 30 fps with film motion blur, H.264, AAC 192k at -14 LUFS).

How it's made (repo root):
1. Start the site in demo mode (mock API on :4000, web on :3000) and take the product shots:
   `node brand/uspad/src/launch-shots.cjs http://localhost:3000 brand/uspad/social/launch-shots brand/uspad/social/launch-shots/mooncat.png`
   It types the create form key by key (`type-NN.jpg`, field positions in `type.json`) and takes a coin
   page on a phone (`mobile-coin.jpg`). The desktop coin page comes from `live-shots/coin.jpg` (`live-shots.cjs`).
2. `node brand/uspad/src/launch-video.cjs brand/uspad` (`--stills <dir>` for one frame per scene). The 3D
   coins are the site's own (`apps/web/src/three/scenes.ts`, through `coins3d.ts`), rendered frame by frame
   in headless Chromium with a soft glow; three renderers share the frames and the parts are joined without
   re-encoding. Each frame averages 4 renders over a 180° shutter for motion blur, so a render takes about
   an hour and a half on 4 cores.
3. `python3 brand/uspad/src/launch-music.py brand/uspad` (the soundtrack; needs numpy and ffmpeg).

The shots are the real interface with the demo's sample data, and the video says so on every window
("Interface preview, sample data") and in the closing line. The demo shows "Cost to launch: Free"; the
camera never frames it, because a launch on uspad.fun costs the launch fee plus the create. Every uspad
fact matches the How it works page.

Scenes: the Koin belah mark's two halves fly together into the uspad lockup → out of the dark, the uspad
coin turns to face the camera as the six stock coins arrive: "uspad.fun is live." → "Anyone can launch a
coin." → step 1, name it and pick the stock (the create form typed into, a pointer clicking each field and
the NVDAx tile) → step 2, approve once in your wallet (a wallet sheet, Approve clicked, the launch steps) →
step 3, live in one private bundle (the coin page, its launch card and the coin on a phone) → the six stock
coins drop in: its holders get paid in US stocks, every hour → creators earn 0.15% of every trade on the
curve, and the 1.25% split → "Launch yours." uspad.fun.

## Post (under 280 characters)

```text
uspad.fun is live. 🟢

Anyone can launch a coin:
1. Name it, pick the stock
2. Approve once in your wallet
3. Live in a private bundle

Its holders get paid in US stocks, every hour. Creators earn 0.15% of every trade.

Launch yours → uspad.fun
```

## Versi Indonesia

```text
uspad.fun sudah live. 🟢

Siapa pun bisa launch koin:
1. Beri nama, pilih sahamnya
2. Setujui sekali di wallet
3. Live lewat private bundle

Holder-nya dibayar saham Amerika setiap jam. Creator dapat 0,15% dari setiap trade.

Launch sekarang → uspad.fun
```
