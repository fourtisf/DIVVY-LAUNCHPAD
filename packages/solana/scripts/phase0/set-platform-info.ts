/**
 * set-platform-info.ts — changes the name, web link and picture that the PlatformConfig shows on
 * Raydium (the owner renamed the product hwai on 2026-10-31; it was created as uspad), and SIMULATES it.
 *
 * DEFAULT IS DRY RUN. It only sends when BOTH `--send` is passed AND env I_HAVE_OWNER_APPROVAL=yes.
 * Only the fields given change. Each is its own one-field update (no `updateAll`, which would rewrite
 * the fees and wallets too). The simulation returns the account as it would be after the update, and
 * the script refuses to send unless exactly the asked fields changed and everything else (fee rates,
 * wallets, scales) reads the same.
 *
 * Updates are rate-limited per epoch (docs only, docs/VERIFIED.md item 28). The script first tries
 * every change in one transaction; if that simulation fails, it tries the first change alone and says
 * which ones to run again in a later epoch.
 *
 * Usage (dry run with just a pubkey):
 *   RPC_URL=... PLATFORM_ADMIN_PUBKEY=<admin> NAME=hwai npx tsx set-platform-info.ts
 * Usage (send):
 *   RPC_URL=... PLATFORM_ADMIN_KEYPAIR=/path/admin.json NAME=hwai WEB=https://hwai.ai \
 *     IMG=https://hwai.ai/brand/hwai-mark-512.png I_HAVE_OWNER_APPROVAL=yes npx tsx set-platform-info.ts --send
 * WEB and IMG must answer (IMG with an image) before it sends; ALLOW_UNREACHABLE=yes skips that check.
 *
 * SDK API used (raydium-sdk-V2@b69d02b, npm 0.2.75-alpha):
 *   updatePlatformConfig({ type: "updateName" | "updateWeb" | "updateImg", value: string })
 *     src/raydium/launchpad/instrument.ts:837-900 (param index 4 / 5 / 6, `struct([u8("index"), str("value")])`;
 *     accounts: the platform admin (signer) and the PlatformConfig (writable))
 *   PlatformConfig: name[64], web[256], img[256] as u8 arrays   src/raydium/launchpad/layout.ts:106-136
 *   getPdaPlatformId()                                           src/raydium/launchpad/pda.ts:54
 */
import { readFileSync } from "node:fs";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { LAUNCHPAD_PROGRAM, PlatformConfig, getPdaPlatformId, updatePlatformConfig } from "@raydium-io/raydium-sdk-v2";
import { CU_PRICE_MICROLAMPORTS, priorityLamports, sendUntilLanded } from "./land";

type Field = "name" | "web" | "img";
const TYPE = { name: "updateName", web: "updateWeb", img: "updateImg" } as const;
/** The account's fixed sizes (layout.ts): the value must fit in them. */
const MAX_BYTES: Record<Field, number> = { name: 64, web: 256, img: 256 };
/** Everything an info update must leave alone, as printable strings. */
const KEPT = [
  "feeRate",
  "creatorFeeRate",
  "platformScale",
  "creatorScale",
  "burnScale",
  "platformClaimFeeWallet",
  "platformLockNftWallet",
  "platformVestingWallet",
  "platformVestingScale",
  "platformCpCreator",
  "cpConfigId",
  "transferFeeExtensionAuth",
  "restrictGlobalConfig",
  "restrictCurveParam",
  "curveRuleManager",
] as const;

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`set ${k}`);
  return v;
};
const loadKeypair = (path: string): Keypair => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
type Decoded = ReturnType<typeof PlatformConfig.decode>;
/** A fixed u8 array as text: up to the first zero byte. */
const text = (bytes: number[]): string => {
  const end = bytes.indexOf(0);
  return Buffer.from(end < 0 ? bytes : bytes.slice(0, end)).toString("utf8");
};
const info = (p: Decoded): Record<Field, string> => ({ name: text(p.name), web: text(p.web), img: text(p.img) });
const kept = (p: Decoded): Record<string, string> => Object.fromEntries(KEPT.map((k) => [k, String((p as Record<string, unknown>)[k])]));

/** WEB answers, IMG answers with a picture. */
async function reachable(field: Field, url: string): Promise<string | null> {
  if (field === "name") return null;
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return `${url} answers ${res.status}`;
    if (field === "img" && !(res.headers.get("content-type") ?? "").startsWith("image/")) return `${url} isn't an image (${res.headers.get("content-type")})`;
    return null;
  } catch (e) {
    return `${url} doesn't answer (${(e as Error).message})`;
  }
}

async function main(): Promise<void> {
  const wantSend = process.argv.includes("--send");
  const approved = process.env.I_HAVE_OWNER_APPROVAL === "yes";
  if (wantSend && !approved) throw new Error("--send refused: I_HAVE_OWNER_APPROVAL=yes is not set");

  const conn = new Connection(env("RPC_URL"), "confirmed");
  const admin = process.env.PLATFORM_ADMIN_KEYPAIR ? loadKeypair(process.env.PLATFORM_ADMIN_KEYPAIR) : undefined;
  const adminPk = admin?.publicKey ?? new PublicKey(env("PLATFORM_ADMIN_PUBKEY"));
  if (wantSend && !admin) throw new Error("--send needs PLATFORM_ADMIN_KEYPAIR");

  const want: Partial<Record<Field, string>> = {};
  for (const f of ["name", "web", "img"] as const) {
    const v = process.env[f.toUpperCase()];
    if (v === undefined || v === "") continue;
    const bytes = Buffer.byteLength(v, "utf8");
    if (bytes > MAX_BYTES[f]) throw new Error(`${f.toUpperCase()} is ${bytes} bytes; the account holds ${MAX_BYTES[f]}`);
    if (f !== "name" && !/^https:\/\//.test(v)) throw new Error(`${f.toUpperCase()} must be an https:// link`);
    want[f] = v;
  }
  if (!Object.keys(want).length) throw new Error("set NAME, WEB or IMG");

  const { publicKey: platformId } = getPdaPlatformId(LAUNCHPAD_PROGRAM, adminPk);
  const acc = await conn.getAccountInfo(platformId);
  if (!acc) throw new Error(`PlatformConfig ${platformId.toBase58()} doesn't exist`);
  const before = PlatformConfig.decode(acc.data);
  const now = info(before);
  console.log(`PlatformConfig ${platformId.toBase58()} (last update in epoch ${before.epoch})`);
  for (const f of ["name", "web", "img"] as const) console.log(`  ${f.padEnd(5)} ${JSON.stringify(now[f])}${want[f] !== undefined && want[f] !== now[f] ? `  →  ${JSON.stringify(want[f])}` : ""}`);
  const changes = (["name", "web", "img"] as const).filter((f) => want[f] !== undefined && want[f] !== now[f]);
  if (!changes.length) {
    console.log("Already set. Nothing to do.");
    return;
  }

  const problems = (await Promise.all(changes.map((f) => reachable(f, want[f]!)))).filter((p): p is string => !!p);
  for (const p of problems) console.log(`  ! ${p}`);
  if (problems.length && wantSend && process.env.ALLOW_UNREACHABLE !== "yes")
    throw new Error("not sending: Raydium would link to a page or picture that doesn't load (ALLOW_UNREACHABLE=yes overrides)");

  const CU_LIMIT = 60_000;
  const build = (fields: readonly Field[]) => {
    const instructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE_MICROLAMPORTS }),
      ...fields.map((f) => updatePlatformConfig(LAUNCHPAD_PROGRAM, adminPk, platformId, { type: TYPE[f], value: want[f]! })),
    ];
    return (blockhash: string): VersionedTransaction => {
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: adminPk, recentBlockhash: blockhash, instructions }).compileToV0Message());
      if (admin) tx.sign([admin]);
      return tx;
    };
  };
  /** Simulates and returns the PlatformConfig as it would read afterwards (null when it fails). */
  const simulate = async (fields: readonly Field[]) => {
    const tx = build(fields)((await conn.getLatestBlockhash("confirmed")).blockhash);
    const sim = await conn.simulateTransaction(tx, {
      sigVerify: !!admin,
      replaceRecentBlockhash: !admin,
      accounts: { encoding: "base64", addresses: [platformId.toBase58()] },
    });
    console.log(`\nsimulation of ${fields.join(" + ")}: err ${JSON.stringify(sim.value.err)}, units ${sim.value.unitsConsumed}`);
    console.log((sim.value.logs ?? []).join("\n"));
    const raw = sim.value.accounts?.[0]?.data[0];
    return sim.value.err || !raw ? null : PlatformConfig.decode(Buffer.from(raw, "base64"));
  };

  let fields: readonly Field[] = changes;
  let after = await simulate(fields);
  if (!after && changes.length > 1) {
    fields = changes.slice(0, 1);
    after = await simulate(fields);
    if (after) console.log(`\nOne update at a time: ${changes.slice(1).join(", ")} must wait for a later epoch; run this again then.`);
  }
  if (!after) throw new Error("simulation failed; not sending (if the logs mention the epoch, retry in the next epoch)");

  // Exactly the asked fields change, and nothing that moves money.
  const got = info(after);
  for (const f of ["name", "web", "img"] as const) {
    const expected = fields.includes(f) ? want[f]! : now[f];
    if (got[f] !== expected) throw new Error(`after the update ${f} would read ${JSON.stringify(got[f])}, not ${JSON.stringify(expected)}; not sending`);
  }
  const k0 = kept(before),
    k1 = kept(after);
  const moved = KEPT.filter((k) => k0[k] !== k1[k]);
  if (moved.length) throw new Error(`the update would also change ${moved.join(", ")}; not sending`);
  console.log(`\nAfter: ${fields.map((f) => `${f} ${JSON.stringify(got[f])}`).join(", ")}; fees, wallets and scales unchanged.`);
  console.log(`priority fee ${priorityLamports(CU_LIMIT)} lamports (CU_PRICE_MICROLAMPORTS ${CU_PRICE_MICROLAMPORTS})`);
  if (!wantSend) {
    console.log("\nDRY RUN — nothing sent.");
    return;
  }

  const sig = await sendUntilLanded(
    conn,
    build(fields),
    async () => {
      const a = await conn.getAccountInfo(platformId, "confirmed");
      if (!a) return false;
      const i = info(PlatformConfig.decode(a.data));
      return fields.every((f) => i[f] === want[f]);
    },
    `platform_config.update_info(${fields.join(",")})`,
  );
  if (sig) console.log(`PLATFORM_INFO_SIG=${sig}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
