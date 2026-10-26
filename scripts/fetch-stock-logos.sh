#!/usr/bin/env bash
# Downloads each dividend asset's official token icon from the Trust Wallet assets registry, by mint
# (mints verified in docs/verified/jito-jupiter-xstocks.md), into apps/web/public/stocks/<SYMBOL>.png.
# Check every info.json symbol against the list before committing. Needs `sharp` (apps/api) to resize.
set -euo pipefail
cd "$(dirname "$0")/.."
B=https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana
TMP=$(mktemp -d)
while read -r sym mint; do
  if [ "$mint" = "-" ]; then url=$B/info; else url=$B/assets/$mint; fi
  curl -sfm 30 -o "$TMP/$sym.png" "$url/logo.png"
  printf '%-7s %s\n' "$sym" "$(curl -sfm 30 "$url/info.json" | grep -m1 '"symbol"')"
done <<'LIST'
NVDAx Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh
SPYx XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W
TSLAx XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB
AAPLx XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp
QQQx Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ
GOOGLx XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN
AMZNx Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg
MSTRx XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ
COINx Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu
HOODx XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg
CRCLx XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1
SOL -
USDC EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
LIST
NODE_PATH=apps/api/node_modules node -e '
const sharp = require("sharp"), fs = require("fs"), path = require("path");
const [src, dst] = process.argv.slice(1);
(async () => { for (const f of fs.readdirSync(src)) await sharp(path.join(src, f)).resize(256, 256, { fit: "cover" }).png({ compressionLevel: 9, palette: false }).toFile(path.join(dst, f)); })();
' "$TMP" apps/web/public/stocks
rm -rf "$TMP"
