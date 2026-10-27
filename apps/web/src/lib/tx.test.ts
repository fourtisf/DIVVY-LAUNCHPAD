import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, type Connection, type VersionedTransaction } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { confirmSignature, NotEnoughSol, payLaunchFee, SentUnconfirmed, TxExpired } from "./tx";

type Status = { confirmationStatus?: string; err?: unknown } | null;

/** A relay that answers statuses from a script, one per poll; "throw" stands for a failed request. */
function fakeConn(o: { statuses: (Status | "throw")[]; history?: Status; height?: (poll: number) => number; balance?: number }) {
  let poll = 0;
  const sent: string[] = [];
  const conn = {
    getSignatureStatuses: vi.fn(async (_sigs: string[], cfg?: { searchTransactionHistory?: boolean }) => {
      if (cfg?.searchTransactionHistory) return { value: [o.history ?? null] };
      const s = o.statuses[Math.min(poll++, o.statuses.length - 1)];
      if (s === "throw") throw new Error("429 Too Many Requests");
      return { value: [s] };
    }),
    getBlockHeight: vi.fn(async () => (o.height ? o.height(poll) : 0)),
    getBalance: vi.fn(async () => o.balance ?? 1e9),
    getLatestBlockhash: vi.fn(async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 100 })),
    sendRawTransaction: vi.fn(async (_raw: Uint8Array, opts?: { skipPreflight?: boolean }) => {
      sent.push(opts?.skipPreflight ? "resend" : "send");
      return "SIG";
    }),
  };
  return { conn: conn as unknown as Connection, sent, raw: conn };
}

/** Runs the polling to the end on fake timers. */
async function settle<T>(p: Promise<T>): Promise<T> {
  const r = p.then((v) => ({ v }), (e: unknown) => ({ e }));
  for (let i = 0; i < 200; i++) await vi.advanceTimersByTimeAsync(1000);
  const out = await r;
  if ("e" in out) throw out.e;
  return out.v;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("confirmSignature", () => {
  it("waits through RPC errors instead of calling a sent payment unconfirmed", async () => {
    const { conn } = fakeConn({ statuses: [null, "throw", "throw", "throw", null, { confirmationStatus: "confirmed" }] });
    await expect(settle(confirmSignature(conn, "SIG", 100))).resolves.toBe("SIG");
  });

  it("says a transaction expired, with nothing spent, once its blockhash is past and the chain has no trace of it", async () => {
    const { conn } = fakeConn({ statuses: [null], height: () => 101, history: null });
    await expect(settle(confirmSignature(conn, "SIG", 100))).rejects.toBeInstanceOf(TxExpired);
  });

  it("finds one that landed in the last valid block", async () => {
    const { conn } = fakeConn({ statuses: [null], height: () => 101, history: { confirmationStatus: "finalized" } });
    await expect(settle(confirmSignature(conn, "SIG", 100))).resolves.toBe("SIG");
  });

  it("reports a transaction that failed on chain", async () => {
    const { conn } = fakeConn({ statuses: [{ err: { InstructionError: [2, "Custom"] } }] });
    await expect(settle(confirmSignature(conn, "SIG", 100))).rejects.toThrow(/failed on chain/);
  });

  it("gives up as unconfirmed only after half a minute without any answer", async () => {
    const { conn } = fakeConn({ statuses: ["throw"] });
    await expect(settle(confirmSignature(conn, "SIG", 100))).rejects.toBeInstanceOf(SentUnconfirmed);
  });

  it("sends the transaction again while its blockhash is still valid", async () => {
    const { conn, sent } = fakeConn({ statuses: [null, null, null, null, null, null, { confirmationStatus: "confirmed" }] });
    const resend = vi.fn(async () => "SIG");
    await settle(confirmSignature(conn, "SIG", 100, resend));
    expect(resend).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([]);
  });
});

describe("payLaunchFee", () => {
  const owner = Keypair.generate().publicKey;
  const to = Keypair.generate().publicKey.toBase58();
  const wallet = (signed: VersionedTransaction[] = []) =>
    ({
      publicKey: owner,
      signTransaction: vi.fn(async (tx: VersionedTransaction) => {
        signed.push(tx);
        return tx;
      }),
    }) as unknown as WalletContextState;

  it("refuses before the wallet opens when the balance can't cover the fee and the network", async () => {
    const { conn } = fakeConn({ statuses: [null], balance: 20_500_000 });
    const w = wallet();
    await expect(payLaunchFee(w, conn, to, 20_000_000n, () => {})).rejects.toBeInstanceOf(NotEnoughSol);
    expect(w.signTransaction).not.toHaveBeenCalled();
  });

  it("pays with a priority fee, reports the signature at once, and sends again until it confirms", async () => {
    const { conn, sent } = fakeConn({ statuses: [null, null, null, { confirmationStatus: "confirmed" }] });
    const signed: VersionedTransaction[] = [];
    const onSent = vi.fn();
    await expect(settle(payLaunchFee(wallet(signed), conn, to, 20_000_000n, onSent))).resolves.toBe("SIG");
    expect(onSent).toHaveBeenCalledWith("SIG", 100);
    expect(sent).toEqual(["send", "resend"]);
    // Compute unit limit and price, then the transfer.
    expect(signed[0]!.message.compiledInstructions).toHaveLength(3);
  });
});
