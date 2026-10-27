/**
 * getTransaction for every transaction version, not only the ones web3.js 1.x can read.
 *
 * web3.js 1.99 accepts "legacy" and 0 only, and for anything newer the RPC answers -32015: "Transaction
 * version (N) is not supported by the requesting client. Please try the request again with the
 * following configuration parameter: "maxSupportedTransactionVersion": N". Mainnet carries such
 * transactions (decode-recent-trades.ts, 2026-10-27), and one of them on uspad's platform would stop
 * the indexer for good. So on -32015 this asks the RPC again for that version, in its "json" encoding,
 * and rebuilds the fields the parsers read (account keys, compiled and inner instructions, logs, slot,
 * block time). If the RPC's json doesn't have them, TxShapeError says so: the caller stops rather than
 * skip a trade.
 */
import { MessageAccountKeys, PublicKey, type Connection, type LoadedAddresses, type VersionedTransactionResponse } from "@solana/web3.js";
import bs58 from "bs58";

export class TxShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxShapeError";
  }
}

/** The version a -32015 error asks for, or null when the error is something else. */
export function unsupportedVersionOf(e: unknown): number | null {
  const code = (e as { code?: unknown } | null)?.code;
  const msg = e instanceof Error ? e.message : String(e);
  if (code !== -32015 && !/-32015|version \(\d+\) is not supported/i.test(msg)) return null;
  const m = /maxSupportedTransactionVersion"?\s*:\s*(\d+)/.exec(msg) ?? /version \((\d+)\)/i.exec(msg);
  return m ? Number(m[1]) : null;
}

export async function getTransactionAnyVersion(conn: Connection, signature: string): Promise<VersionedTransactionResponse | null> {
  try {
    return await conn.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  } catch (e) {
    const version = unsupportedVersionOf(e);
    if (version === null) throw e;
    const res = await fetch(conn.rpcEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: version }] }),
    });
    if (!res.ok) throw new Error(`getTransaction (version ${version}) HTTP ${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
    if (body.error) throw new Error(`getTransaction (version ${version}): ${body.error.code} ${body.error.message}`);
    return body.result ? fromJsonEncoding(body.result, version) : null;
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isIx = (v: unknown) => isObj(v) && typeof v.programIdIndex === "number" && Array.isArray(v.accounts) && typeof v.data === "string";

/** A getTransaction result in the "json" encoding, as the parts of a VersionedTransactionResponse the parsers read. */
export function fromJsonEncoding(result: unknown, version: number): VersionedTransactionResponse {
  const shape = (why: string) => new TxShapeError(`version ${version} transaction: ${why}; the indexer can't read it`);
  if (!isObj(result) || !isObj(result.transaction) || !isObj(result.meta)) throw shape("no transaction or meta");
  const msg = result.transaction.message;
  if (!isObj(msg)) throw shape("no message");
  const { accountKeys, instructions } = msg;
  if (!Array.isArray(accountKeys) || !accountKeys.every((k) => typeof k === "string")) throw shape(`no accountKeys (message has ${Object.keys(msg).join(", ")})`);
  if (!Array.isArray(instructions) || !instructions.every(isIx)) throw shape("no instructions in the expected form");
  const meta = result.meta;
  const inner = meta.innerInstructions ?? [];
  if (!Array.isArray(inner) || !inner.every((g) => isObj(g) && typeof g.index === "number" && Array.isArray(g.instructions) && g.instructions.every(isIx)))
    throw shape("innerInstructions in an unexpected form");
  const lookups = isObj(meta.loadedAddresses) ? meta.loadedAddresses : { writable: [], readonly: [] };
  const loadedAddresses: LoadedAddresses = {
    writable: ((lookups.writable as string[] | undefined) ?? []).map((k) => new PublicKey(k)),
    readonly: ((lookups.readonly as string[] | undefined) ?? []).map((k) => new PublicKey(k)),
  };

  const staticAccountKeys = (accountKeys as string[]).map((k) => new PublicKey(k));
  const compiledInstructions = (instructions as { programIdIndex: number; accounts: number[]; data: string }[]).map((ix) => ({
    programIdIndex: ix.programIdIndex,
    accountKeyIndexes: ix.accounts,
    data: bs58.decode(ix.data),
  }));
  const message = {
    header: msg.header,
    recentBlockhash: msg.recentBlockhash,
    staticAccountKeys,
    compiledInstructions,
    addressTableLookups: msg.addressTableLookups ?? [],
    getAccountKeys: (a?: { accountKeysFromLookups?: LoadedAddresses | null }) => new MessageAccountKeys(staticAccountKeys, a?.accountKeysFromLookups ?? undefined),
  };
  return {
    slot: result.slot,
    blockTime: result.blockTime ?? null,
    version,
    transaction: { signatures: result.transaction.signatures, message },
    meta: { ...meta, innerInstructions: inner, loadedAddresses },
  } as unknown as VersionedTransactionResponse;
}
