# Divvy brand kit

The reference logo and assets live in [`brand/`](../brand/). Open [`brand/index.html`](../brand/index.html) in a browser to see the brand sheet: every asset on dark and white backgrounds, plus color tokens, minimum sizes, clear space and the don't list.

Nothing in the kit is a new design. Every shape, color and size comes from the approved prototype, `prototype/divvy-prototype.html` (CLAUDE.md rule 1). Line numbers below refer to that file.

## Status of the wordmark: live text, not outlined yet

Clash Display (the prototype's display face, line 10) comes from Fontshare under the ITF Free Font License. It isn't in this repo. The build environment can't reach api.fontshare.com, and there's no legitimate npm redistribution of it: on 2026-10-26, `clash-display`, `@fontshare/clash-display`, `@fontsource/clash-display` and `typeface-clash-display` all returned 404, and the npm search turned up only UI kits that reference it.

So:

- The wordmark in `logo-horizontal*.svg` and `og-default.svg`, and the ring text, `$` and "divvy" in `logo-coin.svg`, are SVG `<text>` with `font-family="Clash Display, 'Plus Jakarta Sans', system-ui, sans-serif"`. That's the prototype's `--display` stack (line 23).
- All PNGs were rendered with Plus Jakarta Sans, the prototype's own fallback (line 13). They match what the prototype shows when Fontshare can't load, but not what it shows with Clash Display.
- `brand/index.html` loads Clash Display from Fontshare like the prototype does, so on a normal network the sheet shows the real face.
- The live site doesn't need any of this: the header logo there is CSS and text, and it loads the real fonts.

**Before you use the wordmark in print or production files, outline it from a licensed copy of Clash Display:**

1. Download Clash Display from fontshare.com on a design machine. Don't commit the font files (the license doesn't allow redistribution).
2. Open the SVG in Figma, Illustrator or Inkscape with Clash Display Semibold (600) installed. Use Bold (700) for the coin's `$`.
3. Check the position. Baselines were placed for Plus Jakarta Sans metrics. In the prototype the wordmark is a `line-height: 1` box centered on the mark (line 47), so center the Clash Display text vertically on the 32px mark. Keep x = 42 (32px mark + 10px gap), 25px size and −0.75px letter-spacing (−0.03em). On the coin, each glyph is centered on its point (canvas `textBaseline: "middle"`, line 631).
4. Convert the text to paths (Illustrator: Type → Create Outlines; Inkscape: Path → Object to Path; Figma: Flatten).
5. Re-export the PNGs from the outlined SVGs at the sizes in the table below.

## Files

| File | Size | Use |
|---|---|---|
| `logo-mark.svg` | 32×32 | The mark, flat (no outer glow). UI, docs, anywhere small. |
| `logo-mark-glow.svg` | 56×56 | The mark with its drop glow, for dark backgrounds. The mark sits at (12, 6) because the glow falls downward. |
| `favicon.svg` | 32×32 | Same bytes as `logo-mark.svg`. Copy it to `apps/web/src/app/icon.svg`. |
| `favicon-32.png` | 32×32 | Transparent PNG favicon for browsers that don't take SVG icons. |
| `logo-horizontal.svg` | 104×32 | Mark and wordmark in `--text`, transparent. Dark backgrounds only. |
| `logo-horizontal-ink.svg` | 104×32 | The same lockup with the wordmark in `--g-ink`, for light backgrounds. |
| `logo-horizontal-dark.svg` | 152×70 | The header crop: lockup with the glow on `#0A0F0D`, 70px tall, 24px side padding. |
| `logo-coin.svg` | 512×512 | The hero coin's face, circular with transparent corners. |
| `logo-coin-512.png` | 512×512 | The full square coin texture, for avatar uploads (X, Telegram and DEX listings crop it to a circle). |
| `app-icon.svg` | 512×512 | Source for the three app icon PNGs. |
| `apple-touch-icon.png` | 180×180 | Copy it to `apps/web/src/app/apple-icon.png`. |
| `icon-192.png`, `icon-512.png` | 192, 512 | Web app manifest icons. The mark stays inside the maskable safe zone, so they also work as `purpose: "maskable"`. |
| `og-default.svg` | 1200×630 | Source for the share image. |
| `og-default.png` | 1200×630 | Copy it to `apps/web/src/app/opengraph-image.png` and `twitter-image.png`, with alt text "Divvy: memecoins that pay you real stock dividends." in `opengraph-image.alt.txt`. |
| `index.html` | | The brand sheet. |

Next.js picks these files up by name in `app/`, so `layout.tsx` doesn't need an `icons` entry.

## How each asset maps to the prototype

### Mark (`logo-mark.svg`, `logo-mark-glow.svg`, `favicon.svg`)

Source: `.logo-mark` and `.logo-mark::after`, lines 48–49. The mark is a 32px circle (28px on phones, line 408).

| CSS (line 48–49) | SVG |
|---|---|
| `background: var(--foil)`, the 115° gradient on line 22 | `linearGradient` in user space from (−3.2706, 7.0139) to (35.2706, 24.9861). That's the CSS gradient line for 115° on a 32×32 box, with the same five stops. |
| `inset 0 -4px 8px rgba(3,20,10,.35)` | The area outside a circle shifted 4px up, filled `#03140A` at .35, blurred with σ = 4 (half the CSS blur radius) and clipped to the disc. |
| `inset 0 0 0 2px rgba(255,255,255,.45)` | Circle r = 15, 2px white stroke at .45, on top of the shade (the first shadow in the list paints on top). |
| `::after`: `inset: 7px`, `border: 2px dashed rgba(3,20,10,.5)` | Five arcs on r = 8, 2px wide, `#03140A` at .5, square ends. |
| `0 6px 16px -6px rgba(74,222,128,.7)` (glow variant only) | Circle r = 10 at (16, 22), `#4ADE80` at .7, blurred with σ = 8. |

CSS doesn't define where the dashes of a dashed rounded border go; each browser decides. The arcs were measured from Chromium's render of the prototype at 32× zoom. Clockwise from 12 o'clock they run −9.0°→42.85°, 70.1°→113.1°, 140.5°→183.5°, 210.8°→253.75° and 280.95°→323.8°. Chromium uses 6px dashes with gaps of about 3.8px, starting at the top, and the leftover length merges into the first dash, which is why the top dash is longer. Other browsers may place the prototype's dashes differently; the SVG freezes Chromium's.

### Horizontal lockups (`logo-horizontal*.svg`)

Source: `.logo`, line 47, and the header markup, line 456. The 32px mark, a 10px gap, then "divvy" at 25px, weight 600, letter-spacing −0.03em (−0.75px), in `--text` `#EAFBF1` (inherited from `body`, line 31). In SVG units the text starts at x = 42 with its baseline at y = 26. The viewBox is 104 wide, which holds the glyphs (they end at about x = 103.4).

`logo-horizontal-dark.svg` is the header itself: 70px tall (line 46), 24px side padding (`.wrap`, line 38), the logo centered vertically, and the mark's glow. The header background is `rgba(10,15,13,.78)` over the page (line 45), which is `#0A0F0D` to within a level or two.

The prototype is dark only, so `logo-horizontal-ink.svg` is the one variant it doesn't draw. It uses the prototype's own ink color, `--g-ink` `#03140A` (line 19), which is what the prototype puts on light foil surfaces.

### Coin (`logo-coin.svg`, `logo-coin-512.png`)

Source: `logoFace()`, lines 633–644, with `hiCanvas()`, `ringText()` and `guilloche()` on lines 630–632. It's the texture on both faces of the 3D hero coin (line 713). The canvas is 1024px, drawn in 512 units, so the SVG uses a 512 viewBox.

| Canvas | SVG |
|---|---|
| `createRadialGradient(180,160,30, 256,256,270)`: `#1f5236`, `#0d2819` at .65, `#06150d` | `radialGradient` with focal point fx 180, fy 160, fr 30 and end circle cx 256, cy 256, r 270 |
| `guilloche(g, "rgba(134,239,172,.08)")`: 30 curves, a step of .025 rad | 30 separate paths, so overlaps build up alpha the way separate canvas strokes do |
| Rings at r 236 (3px, .6) and r 192 (1.5px, .28) | Same circles, `#86EFAC` |
| `ringText(..., 214, "600 19px", "rgba(200,255,224,.78)")`: one glyph per slot, slot angle i·360°/n | One rotated `<text>` per glyph. The baseline sits 0.3238em below the canvas "middle" line, measured from Plus Jakarta Sans in Chromium. |
| `✦` in the ring text | A path. Neither Clash Display nor Plus Jakarta Sans has U+2726, so the prototype draws it from a system fallback. On Linux Chromium that's DejaVu Sans with synthetic bold. The path is DejaVu Sans's outline (Bitstream Vera license) with a 0.8 stroke, which best matches that synthetic bold. |
| `$`: `700 230px` at (256, 236), gradient (200,120)→(330,380) `#E3FFEE`/`#4ADE80` .45/`#C5F56A`, `shadowBlur 40`, `rgba(74,222,128,.85)` | `<text>` with the same gradient and a drop-shadow filter with σ = 10. Canvas shadow blur is in device pixels and isn't scaled by the 2× transform, so it's 20 units of blur radius, which is σ = 10. |
| "divvy": `600 46px`, `#DFFFEA` at (256, 370) | `<text>` at the same point, no glow (the canvas resets `shadowBlur` first) |

`CircleGeometry` maps the texture's inscribed circle onto the coin face, so `logo-coin.svg` is clipped to r = 256. `logo-coin-512.png` is the whole square, like the canvas. The 3D coin adds a metallic rim, lighting and tilt (lines 671–681); those aren't part of the emblem.

### App icons (`app-icon.svg` and its PNGs)

The header's mark on `--bg` `#0A0F0D`, with its glow, at 9/16 of the tile (288px on 512). That keeps the mark's radius at 28% of the tile, inside the 40% maskable safe zone. The tile layout is the one choice the prototype doesn't make for us.

### Share image (`og-default.svg`, `og-default.png`)

Built from the hero, element by element:

- Background: `#0A0F0D` with the page glow from `body::before` (line 32), sized to a 1200×720 box.
- Lockup at 2× (64px mark), top left, 72px margin.
- Headline: the hero `<h1>` copy (line 811) with the `.hero h1` style (line 94) at 84px: weight 600, line-height .98, letter-spacing −0.04em. It wraps the way the prototype does on desktop: "Memecoins that / pay you real stock / dividends." The `.glow` gradient (line 95, 100°) spans "real stock" and "dividends." as one strip, the way CSS paints an inline background across two lines.
- Coin: the `logoFace()` emblem at 340px with the `.halo` (line 103) and the `.fallback-coin` drop glow (line 105), both scaled up from their hero sizes.

## Colors

All from `:root`, lines 15–28. The brand sheet shows them all.

| Token | Value | Use |
|---|---|---|
| `--g` | `#4ADE80` | Primary green: buttons, up values, glows |
| `--g-hi` | `#86EFAC` | Hover, active nav, links, the coin's rings |
| `--g-deep` | `#16A34A` | Start of the curve progress bar (line 188) |
| `--g-ink` | `#03140A` | Text on foil and green, the mark's dashed ring and shade |
| `--bg` | `#0A0F0D` | Page background, app icon tiles |
| `--text` | `#EAFBF1` | Body text and the wordmark |
| `--foil` | 115°: `#C9FFE0` 0%, `#86EFAC` 26%, `#E4FFA6` 52%, `#7EF2D8` 76%, `#C9FFE0` 100% | The mark, coupon stubs (196), rank badges (140), step numbers (322, 363), wallet avatar (70) |
| Headline glow | 100°: `#B6FFD2` 0%, `#4ADE80` 45%, `#D9F99D` 100% | Only "real stock dividends." in the hero (line 95) |

## Usage

- **Minimum size.** The mark alone works down to 16px (favicon only) and 20px in UI. Below 20px its white inner ring fades out on white, but the disc and dashed ring still read. Keep the lockup at a 24px mark or larger; the prototype's smallest is 28px on phones (lines 407–408).
- **Clear space.** Keep half the mark's height clear on every side, which is 16px at the header's 32px. The prototype gives the logo 19px above and below in the 70px header (line 46) and 16px in the 60px phone header (line 406).
- **Backgrounds.** Use `logo-horizontal.svg` on dark and `logo-horizontal-ink.svg` on light. The glow is for dark backgrounds only.
- **Copy.** The wordmark is always lowercase "divvy". Everything else is sentence case with plain verbs (CLAUDE.md rule 8). The coin's ring text is the one all-caps line, and it stays as engraved in the prototype.

### Don't

- Don't recolor the mark or the foil, and don't add outlines or new effects.
- Don't stretch, squash, skew or rotate the logo. Scale it evenly.
- Don't use the foil on body text. Text is `--text` or `--muted`; only the hero headline gets the green glow.
- Don't set the wordmark in caps or title case.
- Don't put the light wordmark on a light background.
- Don't redraw the dashed ring or change its five dashes.
- Don't ship the live-text wordmark in print. Outline it first (see above).

## How it was checked

The SVGs were rendered in Chromium (Playwright) and compared with the prototype's own rendering:

- **Header at 4×.** The brand sheet's header uses the same geometry as the prototype's. Diffed at 4×, the wordmark matches with no offset (mean difference 0.03/255). The mark differs only in anti-aliasing at the circle and dash edges (mean 0.6/255 across the crop, max 74 on edge pixels).
- **Mark at 16×.** Compared with the CSS `.logo-mark` on the same background: mean 0.7/255, max 60, with 0.01% of pixels more than 24 off. Chromium cuts the box-shadow blur off at about 2σ, so the SVG glow keeps a faint tail of at most 2/255 past where the CSS one stops.
- **Coin.** Compared with the `logoFace()` canvas, exported from the prototype page at 1024px: mean 0.36/255, max 58.
- **Share image headline.** Compared with the same headline laid out by the prototype's CSS: no offset, mean 0.28/255 over the headline.

The SVGs also parse as XML, and a visual check in librsvg (sharp) shows the gradients, the focal radius `fr` and the filters coming out the same. librsvg uses its own fallback font for the text.

PNGs are Chromium screenshots of the SVGs placed inline in a page that loads Plus Jakarta Sans from Google Fonts, at 1× device scale and the exact pixel size of each file.

## Known differences from the prototype

1. The PNGs use Plus Jakarta Sans for the wordmark, the headline and the coin text. With Clash Display loaded, the prototype's letterforms and widths differ.
2. The dashed ring and the `✦` star follow Chromium on Linux. Other browsers and systems draw the prototype's dashes and its fallback star a little differently.
3. The coin emblem is the flat face texture. The hero shows it on a 3D coin with a metallic rim, lighting and motion.
4. `logo-horizontal-ink.svg`, the app icon tile layout and the share image layout are put together from prototype parts. The prototype has no light theme, app icons or share image of its own.

## Premium logo concepts (proposals, 2026-10-26)

The owner asked for several premium logo options. They live in [`brand/concepts/`](../brand/concepts/) and are proposals only: the site still uses the prototype's mark above (CLAUDE.md rule 1) until the owner picks one.

Open `brand/concepts/boards/00-overview.png` for all six, and `01-…` to `06-…` for each concept on dark and light backgrounds, as an app icon, as a token avatar, at 64/32/16 px and in one color.

| # | Folder | Name | Idea |
|---|---|---|---|
| 01 | `split/` | Koin belah | One coin cut in two, the right half lifted: value being divided, and a lowercase d. |
| 02 | `share/` | Potongan | A coin with one slice lifted out: the holders' share, paid every hour. |
| 03 | `dial/` | Jam | A watch dial: twelve hours, twelve payouts, a coin at the top of the hour, the d at the centre. |
| 04 | `seal/` | Segel | An engraved medallion with a bead border and guilloche, like the seal on a share certificate. Has `mark-small.svg` for 32 px and below. |
| 05 | `facet/` | Permata | The coin cut like a gem, with the d on its table. |
| 06 | `rise/` | Naik | A chart that dips and climbs, ending in a coin. |

All six share one custom wordmark (`wordmark-dark.svg`, `wordmark-light.svg`): geometric lowercase "divvy", drawn as paths with pointed v's and a foil coin for the dot of the i. Because it's drawn, not typeset, it needs no font file or license, unlike the Clash Display wordmark above. Colors are the prototype's tokens: the foil gradient and `--bg`, `--text` and `--g-ink`, plus a darker "struck" foil (`#14532D` to `#4ADE80`) so the marks keep their contrast on light backgrounds.

Each concept folder holds:

| File | Use |
|---|---|
| `mark.svg`, `mark-512.png` | The mark in foil, for dark backgrounds |
| `mark-light.svg` | The mark in the darker foil, for light backgrounds |
| `mark-mono.svg`, `mark-ink.svg` | One color: `--text` for dark, `--g-ink` for light (stamps, print, embossing) |
| `lockup-dark.svg`, `lockup-dark-1200.png` | Mark and wordmark for dark backgrounds |
| `lockup-light.svg`, `lockup-light-1200.png` | Mark and wordmark for light backgrounds |
| `app-icon.svg`, `app-icon-512.png` | 512 px rounded tile; the mark stays inside the maskable safe zone |

To change a concept, edit `brand/concepts/src/gen.py`, then regenerate the SVGs and boards from the repo root:

```sh
python3 -I brand/concepts/src/gen.py brand/concepts
node brand/concepts/src/boards.cjs brand/concepts brand/concepts/boards
```

Once the owner picks one, it replaces the mark, favicons, app icons and share image above, and the site header and `Coin3D` face are updated to match.

## uspad.fun (name proposed by the owner, 2026-10-26)

The owner proposed renaming the product to **uspad.fun**: "us" for "kita" (we) and for US stocks, "pad" for launchpad, `.fun` as memecoin launchpads do. [`brand/uspad/`](../brand/uspad/) holds the identity: the Koin belah mark with a custom-drawn "uspad" and "uspad.fun" wordmark (same geometric system as the concept wordmark, paths only, no font needed). The ".fun" is muted and its dot is a foil coin. `board.png` shows it all, with a tagline suggestion: "Memecoins that pay us. In US stocks."

The owner confirmed the name on 2026-10-26 and the site now uses it: the header lockup (`apps/web/public/brand/uspad-lockup.svg`), the favicon and app icons, the share image (`social.cjs` renders it as `social/og-1200x630.png`) and every user-facing "Divvy" in the copy and the 3D coin. Internal names (`@divvy/*`, env vars, Redis keys) and these docs keep Divvy. Keep the US geofence (xStocks can't be offered to US persons), and include the name in the legal review. Regenerate with `python3 -I brand/uspad/src/uspad.py brand/uspad && node brand/uspad/src/board.cjs brand/uspad`.

## hwai.ai (the owner's name, 2026-10-31)

The owner renamed the product **hwai** and bought `hwai.ai` on 2026-10-31, together with a Chinese-first site (Simplified Chinese by default, English one click away; `apps/web/src/i18n/README.md`). Before deciding they were told three things, and chose hwai anyway: "HW" is a common short form of Huawei (华为) in China and a "HuaweiAI" token exists on Solana, so Chinese readers may read HWAI as Huawei AI; `.ai` suggests an AI product; and "huai" in the fourth tone is 坏 ("bad"). No Han characters have been picked for the name; the site shows the Latin "hwai". Include the name in the legal review (trademark search), with the US geofence as before.

[`brand/hwai/`](../brand/hwai/) holds the identity. The owner dropped uspad entirely, its Koin belah mark included, so hwai has its own mark: a **square-holed cash coin (方孔钱)**, money and China in one shape, in the prototype's foil with an engraved rim and an engraved frame round the hole. It reads at favicon size. Three other concepts were drawn on 2026-10-31 (the same coin with a diamond hole, a jade ingot 玉元宝, a seal 印章) and can replace it by swapping `mark()` in `src/hwai.py`. The wordmark is a drawn "hwai" / "hwai.ai" in a geometric system (x-height 40, stems 8, paths only, no font file); the ".ai" is muted and its dot is a foil coin.

`src/social.cjs` renders the share image (`social/og-1200x630.png`, copied to `apps/web/src/app/opengraph-image.png` and `twitter-image.png`), an X profile photo and header with the Chinese hero line, and the PNG icons (`mark-512.png`, `app-icon-512.png`, `apple-icon-180.png`, `favicon-32.png`). Regenerate with `python3 -I brand/hwai/src/hwai.py brand/hwai && node brand/hwai/src/social.cjs brand/hwai` (the second needs Google Fonts for Noto Sans SC), then copy: `mark.svg` at 32 px to `apps/web/src/app/icon.svg`, `apple-icon-180.png` to `apps/web/src/app/apple-icon.png`, `favicon-32.png` to `apps/web/public/favicon.png`, `mark-512.png` to `apps/web/public/brand/hwai-mark-512.png` and `uspad-mark-512.png` (below), `lockup-dark.svg` to `apps/web/public/brand/hwai-lockup.svg`.

What the site uses: the header lockup, the favicon and app icons, the share image, and `BRAND` (packages/shared) in every user-facing string, in the API's messages, the wallet sign-in statement, the worker's alerts, new coins' `createdOn` metadata and on the 3D coin's face. The hero coin's ring text stays English, as an engraving. X and Telegram handles are build-time env (`NEXT_PUBLIC_X_HANDLE`, `NEXT_PUBLIC_TELEGRAM_HANDLE`, set with `go-live.sh socials <x> <tg>`): while unset, the site shows no X or Telegram links.

[`brand/uspad/`](../brand/uspad/) is retired: the old identity and its posts and videos, kept for the record. Nothing in the site uses it.

Still named uspad, each waiting for the owner:

- **The $USPAD token** and its posts in `brand/uspad/social/`. The hero's CA pill shows whatever `NEXT_PUBLIC_TOKEN_CA` holds (`go-live.sh token-ca off` hides it).
- **The PlatformConfig on mainnet** keeps name `uspad`, web `https://uspad.fun` and image `https://uspad.fun/brand/uspad-mark-512.png` (VERIFIED item 27). Changing them is a mainnet transaction: it needs the update instruction confirmed against the LaunchLab IDL (rule 2) and the owner's approval (rule 3). Meanwhile `apps/web/public/brand/uspad-mark-512.png` holds the hwai mark, so that image URL already shows hwai.
- **The production domain**: `deploy/mainnet/go-live.sh` still serves `uspad.fun`. Moving to `hwai.ai` means pointing its DNS at the server, a certificate, the Nginx server name and `WEB_ORIGIN`; keep `uspad.fun` redirecting so links in posts keep working.

## Stock token logos

Every dividend asset shows its own token icon: in the round chips (filters, coupons, payouts, the trade box) and on the face of the 3D stock coins. They are the tokens' official icons from the Trust Wallet assets registry (`github.com/trustwallet/assets`, `blockchains/solana/assets/<mint>/logo.png`), fetched on 2026-10-26 by the mints verified in `docs/verified/jito-jupiter-xstocks.md`; each registry entry's `info.json` symbol matched (NVDAX, TSLAX, ...). They live in `apps/web/public/stocks/<SYMBOL>.png` (256 px); `apps/web/src/lib/logos.ts` lists them, and a symbol without one falls back to the prototype's initials. `scripts/fetch-stock-logos.sh` downloads them again.

The logos are the companies' and issuers' trademarks, shown only to identify each token, the way wallets and exchanges do. Include them in the legal review.
