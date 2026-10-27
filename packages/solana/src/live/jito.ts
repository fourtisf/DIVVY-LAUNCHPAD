/**
 * Jito block-engine JSON-RPC (jito-labs/jito-docs@9b923b8 docs/source/lowlatencytxnsend.md):
 * sendBundle on /api/v1/bundles with params [[base64 txs], {"encoding":"base64"}] (:178-199),
 * max 5 txs (:25), tip ≥ 1000 lamports to one of the getTipAccounts (:81, :172), 1 req/s (:637).
 */
import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";

export const MAX_BUNDLE_TXS = 5;
export const MIN_TIP_LAMPORTS = 1000;

type Method = "sendBundle" | "getBundleStatuses" | "getInflightBundleStatuses" | "getTipAccounts";
const PATH: Record<Method, string> = {
  sendBundle: "/api/v1/bundles",
  getBundleStatuses: "/api/v1/getBundleStatuses",
  getInflightBundleStatuses: "/api/v1/getInflightBundleStatuses",
  getTipAccounts: "/api/v1/getTipAccounts",
};

export interface InflightStatus {
  bundle_id: string;
  status: "Invalid" | "Pending" | "Failed" | "Landed";
  landed_slot: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class JitoClient {
  private id = 1;
  private lastCall = 0;
  private gate: Promise<void> = Promise.resolve();
  private tipAccounts: { at: number; list: PublicKey[] } | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly uuid?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** One request at a time, 1.1 s apart: concurrent launches queue instead of firing together (audit). */
  private turn(): Promise<void> {
    const next = this.gate.then(async () => {
      const wait = this.lastCall + 1100 - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
    });
    this.gate = next.catch(() => {});
    return next;
  }

  private async call<T>(method: Method, params: unknown[]): Promise<T> {
    // Stay under the default 1 request per second per region.
    await this.turn();
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.uuid) headers["x-jito-auth"] = this.uuid;
    const res = await this.fetchImpl(this.baseUrl.replace(/\/$/, "") + PATH[method], {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: this.id++, method, params }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`jito ${method}: HTTP ${res.status} ${text.slice(0, 200)}`);
    const json = JSON.parse(text) as { result?: T; error?: { code: number; message: string } };
    if (json.error) throw new Error(`jito ${method}: ${json.error.code} ${json.error.message}`);
    return json.result as T;
  }

  /** Tip accounts are stable but never hard-coded; cached for 10 minutes. */
  async getTipAccounts(): Promise<PublicKey[]> {
    if (this.tipAccounts && Date.now() - this.tipAccounts.at < 600_000) return this.tipAccounts.list;
    const list = (await this.call<string[]>("getTipAccounts", [])).map((a) => new PublicKey(a));
    if (!list.length) throw new Error("jito returned no tip accounts");
    this.tipAccounts = { at: Date.now(), list };
    return list;
  }

  async tipInstruction(payer: PublicKey, lamports: number): Promise<TransactionInstruction> {
    if (lamports < MIN_TIP_LAMPORTS) throw new Error(`Jito tip must be at least ${MIN_TIP_LAMPORTS} lamports`);
    const list = await this.getTipAccounts();
    const account = list[Math.floor(Math.random() * list.length)]!;
    return SystemProgram.transfer({ fromPubkey: payer, toPubkey: account, lamports });
  }

  async randomTipAccount(): Promise<PublicKey> {
    const list = await this.getTipAccounts();
    return list[Math.floor(Math.random() * list.length)]!;
  }

  /** Returns the bundle id. Callers must have passed the mainnet gate (config.assertCanSend). */
  sendBundle(base64Txs: string[]): Promise<string> {
    if (base64Txs.length < 1 || base64Txs.length > MAX_BUNDLE_TXS) throw new Error(`a bundle holds 1..${MAX_BUNDLE_TXS} transactions`);
    return this.call<string>("sendBundle", [base64Txs, { encoding: "base64" }]);
  }

  async inflightStatus(bundleId: string): Promise<InflightStatus | null> {
    const r = await this.call<{ value: InflightStatus[] } | null>("getInflightBundleStatuses", [[bundleId]]);
    return r?.value?.[0] ?? null;
  }

  /** Polls until Landed / Failed / Invalid or the timeout (bundles are only tracked for 5 minutes). */
  async waitForBundle(bundleId: string, timeoutMs = 90_000): Promise<InflightStatus | null> {
    const end = Date.now() + timeoutMs;
    let last: InflightStatus | null = null;
    while (Date.now() < end) {
      last = await this.inflightStatus(bundleId).catch(() => last);
      if (last && last.status !== "Pending") return last;
      await sleep(1500);
    }
    return last;
  }
}
