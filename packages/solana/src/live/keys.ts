/**
 * Hot-wallet keypairs are read from files outside the repo (e.g. /etc/divvy/keys/launcher.json,
 * chmod 600). The secret never goes to logs, the database or any response (CLAUDE.md rule 4).
 */
import { readFileSync, statSync } from "node:fs";
import { Keypair } from "@solana/web3.js";

export type WalletRole = "launcher" | "payout_vault" | "fee_claimer";

export function loadKeypair(path: string, role: WalletRole): Keypair {
  const st = statSync(path);
  if (!st.isFile()) throw new Error(`${role} keypair path is not a file`);
  if (process.platform !== "win32" && (st.mode & 0o077) !== 0) {
    throw new Error(`${role} keypair file must not be readable by group or others (chmod 600)`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${role} keypair file is not valid JSON`);
  }
  if (!Array.isArray(raw) || raw.length !== 64 || !raw.every((n) => Number.isInteger(n) && n >= 0 && n < 256)) {
    throw new Error(`${role} keypair file must be a 64-byte JSON array (solana-keygen format)`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(raw as number[]));
}
