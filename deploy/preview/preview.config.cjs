/**
 * PM2 file for the password-protected preview at uspad.fun: the web app and the API in demo mode
 * (API_MODE=mock). No database, no worker, no keys; nothing is signed or sent on chain.
 * Settings come from the repo's .env (deploy/preview/README.md). Run as the `divvy` user:
 *   pm2 start deploy/preview/preview.config.cjs && pm2 save
 * The API must not run with NODE_ENV=production here: mock mode refuses it, on purpose, so demo data
 * can never reach a real launch. The password in Nginx is what keeps this preview private.
 */
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const ENV = `--env-file=${ROOT}/.env`;

module.exports = {
  apps: [
    {
      name: "uspad-api",
      cwd: `${ROOT}/apps/api`,
      script: "dist/server.js",
      node_args: [ENV],
      autorestart: true,
      max_memory_restart: "400M",
    },
    {
      name: "uspad-web",
      cwd: `${ROOT}/apps/web`,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1",
      node_args: [ENV],
      autorestart: true,
      max_memory_restart: "700M",
    },
  ],
};
