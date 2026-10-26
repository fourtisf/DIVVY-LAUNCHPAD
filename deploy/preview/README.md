# Preview deployment (uspad.fun, password-protected demo)

A first deployment that puts the site online at `https://uspad.fun` behind a password, with demo data. It runs the web app and the API in mock mode (`API_MODE=mock`). No database, no worker and no keys are involved, so nothing is signed or sent on any chain.

The full production setup (Postgres, Redis, the worker, keys, separate users per app, GeoIP) is in [`../setup-vps.md`](../setup-vps.md). It comes later, after the checklist in [`../../docs/MAINNET_CHECKLIST.md`](../../docs/MAINNET_CHECKLIST.md).

Why a password: mock mode shows invented coins and payouts and accepts demo launches with picture uploads. On a public domain that would look like a live product. The API refuses mock mode with `NODE_ENV=production` for the same reason, which is why `preview.config.cjs` doesn't set it.

Files:

| File | What it is |
|---|---|
| `preview.config.cjs` | PM2 apps `uspad-api` (mock API on 127.0.0.1:4000) and `uspad-web` (Next.js on 127.0.0.1:3000), both reading the repo's `.env` |
| `nginx-preview.conf` | Nginx site: password on every page and API route, the ACME path open for Let's Encrypt, `/api/live` WebSocket, 404 for other `/api` spellings |

Rehearsed on Ubuntu 24.04 with Node 22, pnpm 10.28 and PM2 7.1.1: build from a fresh clone, PM2 start, and Nginx with the password file at `root:www-data 640`. Checked: 401 without or with a wrong password, 200 with it, `/api/health`, WebSocket upgrade (101), `/API/...` 404, ACME path served without a password. Certbot and the firewall weren't run (no public domain in the rehearsal).

## Before you start

- DNS: an `A` record for `uspad.fun` pointing at the server. If there's an `AAAA` record for `uspad.fun`, it must point at this server's IPv6 address or be deleted: Let's Encrypt tries IPv6 first.
- You're logged in to the server as root.

## 1. Update and reboot (as root)

```bash
apt-get update && apt-get -y upgrade
reboot
```

## 2. Packages, firewall, Node 22, pnpm and PM2 (as root)

```bash
apt-get install -y git curl nginx certbot python3-certbot-nginx ufw dnsutils
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
bash /tmp/nodesource_setup.sh
apt-get install -y nodejs
npm install -g --force pnpm@10.28.0 pm2@7             # --force replaces an older pnpm left in /usr/bin
node --version && pnpm --version && pm2 --version      # v22.x, 10.28.0, 7.x

dig +short uspad.fun A                                  # this server's IPv4
dig +short uspad.fun AAAA                               # empty, or this server's IPv6
```

## 3. The `divvy` user (as root)

```bash
adduser --disabled-password --gecos "" divvy
mkdir -p /srv/divvy && chown divvy:divvy /srv/divvy
```

The repository is public (`github.com/fourtisf/uspad`), so cloning needs no key. If it ever goes private, add a read-only deploy key for the `divvy` user (GitHub: Settings → Deploy keys) and clone over SSH instead.

## 4. Clone, settings and build (as `divvy`)

```bash
su - divvy

git clone --branch claude/new-session-qmy02t https://github.com/fourtisf/uspad.git /srv/divvy/app
cd /srv/divvy/app

cat > .env <<'EOF'
# Preview: demo data only. No database, no keys, nothing on chain.
API_MODE=mock
API_HOST=127.0.0.1
API_PORT=4000
WEB_ORIGIN=https://uspad.fun
API_INTERNAL_URL=http://127.0.0.1:4000
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_TERMS_FINAL=false
LOG_LEVEL=info
EOF
chmod 600 .env

pnpm install --frozen-lockfile
pnpm --filter @divvy/api --filter @divvy/web build

pm2 start deploy/preview/preview.config.cjs
pm2 save
curl -s 127.0.0.1:4000/api/health; echo                  # {"ok":true,"mode":"mock",...}
curl -s -o /dev/null -w "%{http_code}\n" 127.0.0.1:3000/ # 200

exit
```

## 5. Start on boot, password, Nginx and HTTPS (as root)

```bash
pm2 startup systemd -u divvy --hp /home/divvy

read -rsp "Choose a preview password: " PW; echo
printf 'uspad:%s\n' "$(openssl passwd -apr1 "$PW")" > /etc/nginx/uspad-preview.htpasswd
unset PW
chown root:www-data /etc/nginx/uspad-preview.htpasswd
chmod 640 /etc/nginx/uspad-preview.htpasswd

cp /srv/divvy/app/deploy/preview/nginx-preview.conf /etc/nginx/sites-available/uspad.conf
ln -sf /etc/nginx/sites-available/uspad.conf /etc/nginx/sites-enabled/uspad.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

certbot --nginx -d uspad.fun --redirect      # asks for an email and the terms once
```

Open `https://uspad.fun`, then sign in with user `uspad` and the password you chose.

## Updating the preview (as `divvy`)

```bash
su - divvy
cd /srv/divvy/app
git pull
pnpm install --frozen-lockfile
pnpm --filter @divvy/api --filter @divvy/web build
pm2 reload deploy/preview/preview.config.cjs
exit
```

## Useful commands

```bash
sudo -iu divvy pm2 ls                   # both apps online
sudo -iu divvy pm2 logs --lines 50      # recent logs
systemctl status nginx
certbot renew --dry-run                 # the certificate renews on its own; this checks it would
```

To open the site to everyone later, delete the two `auth_basic` lines in each location of `/etc/nginx/sites-available/uspad.conf` and reload Nginx. Do that only once the site runs in live mode with the real setup, not with demo data.
