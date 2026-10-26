/**
 * Runs the Divvy payout-economics scenarios and writes scripts/economics/results.md.
 *
 *   packages/shared/node_modules/.bin/tsx scripts/economics/simulate.ts
 *
 * No network. All inputs come from model.ts (DEFAULT_PARAMS); edit them there or pass overrides below.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ARCHITECTURES,
  ARCH_LABEL,
  type Architecture,
  type Params,
  type Phase,
  DEFAULT_PARAMS,
  JITO_REQUESTS_PER_HOUR,
  JUPITER_FREE_KEY_REQUESTS_PER_HOUR,
  autoPushCostShare,
  breakEvenVolume,
  coinDay,
  feeBuckets,
  graduationFdvSol,
  lamportsToUsd,
  marketState,
  platformCoins,
  platformDay,
  rentFarmMinHolderUsd,
  sourceTable,
  swapFixedShare,
  unitCosts,
  volumeForCostShare,
  withParams,
} from "./model";

const VOLUMES = [1_000, 5_000, 20_000, 50_000, 200_000, 1_000_000];
const SOL_PRICES = [150, 250];
const PHASES: Phase[] = ["curve", "graduated"];
const PLATFORM_SIZES = [10, 100, 1_000];
const SHORT: Record<Architecture, string> = { perCoinPush: "(a)", perCoinCredit: "(b)", batchedPush: "(c)", batchedCredit: "(d)" };

// ─── formatting ────────────────────────────────────────────────────────────

function money(x: number): string {
  if (!Number.isFinite(x)) return "n/a";
  const neg = x < 0;
  const a = Math.abs(x);
  let s: string;
  if (a === 0) s = "0";
  else if (a < 0.01) s = a.toFixed(4);
  else if (a < 1) s = a.toFixed(3);
  else if (a < 100) s = a.toFixed(2);
  else s = Math.round(a).toLocaleString("en-US");
  return (neg ? "−$" : "$") + s;
}
function vol(x: number): string {
  if (x >= 1e6) return `$${+(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `$${+(x / 1e3).toFixed(1)}k`;
  return `$${Math.round(x)}`;
}
function int(x: number): string {
  return Math.round(x).toLocaleString("en-US");
}
function num(x: number, d = 1): string {
  return x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
}
function pct(x: number, d = 1): string {
  if (!Number.isFinite(x)) return "n/a";
  if (x !== 0 && Math.abs(x) < 0.001) return (x * 100).toFixed(3) + "%";
  return (x * 100).toFixed(d) + "%";
}
function table(head: string[], rows: string[][], align?: ("l" | "r")[]): string {
  const al = align ?? head.map((_, i) => (i === 0 ? "l" : "r"));
  const sep = al.map((a) => (a === "l" ? "---" : "---:"));
  return [head, sep, ...rows].map((r) => "| " + r.join(" | ") + " |").join("\n");
}
function be(v: number | null): string {
  if (v === null) return "> $10M";
  if (v <= 100) return "≤ $100";
  return vol(v);
}

// ─── sections ──────────────────────────────────────────────────────────────

function sectionSources(p: Params): string {
  const rows = sourceTable(p).map((r) => [r.item, r.value, r.status, r.source]);
  return `## 1. Inputs and sources\n\n${table(["Input", "Value", "Status", "Source"], rows, ["l", "l", "l", "l"])}\n`;
}

function sectionUnitCosts(): string {
  const rows: string[][] = [];
  const u = unitCosts(DEFAULT_PARAMS);
  const items: [string, number, string][] = [
    ["Rent for one new xStock ATA (paid by whoever creates it)", u.rentLamports, "Divvy under push; the holder under claim"],
    ["Transfer to an existing ATA (share of a tx)", u.transferLamports, `${u.perTxPlain} recipients per tx`],
    ["Transfer + ATA creation, rent excluded (share of a tx)", u.transferWithAtaLamports, `${u.perTxWithAta} recipients per tx`],
    ["xStock or memecoin swap (signature + Jito tip)", u.swapLamports, "per swap"],
    ["Post-graduation harvest (share of a tx)", u.harvestLamports, `${DEFAULT_PARAMS.harvestsPerTx} harvests per tx`],
    ["Platform-vault fee claim", u.vaultClaimLamports, "once per hour for all coins"],
    ["A holder's first claim (rent + 2 signatures + priority)", u.holderFirstClaimLamports, "paid by the holder"],
  ];
  for (const [name, l, note] of items) rows.push([name, int(l), money(lamportsToUsd(l, 150)), money(lamportsToUsd(l, 250)), note]);
  return `## 2. Unit costs\n\n${table(["Item", "Lamports", "At SOL $150", "At SOL $250", "Note"], rows, ["l", "r", "r", "r", "l"])}\n`;
}

function sectionFeePer1k(p: Params): string {
  const curve = feeBuckets("curve", 1_000, p);
  const grad = feeBuckets("graduated", 1_000, p);
  const gradNoCreator = feeBuckets("graduated", 1_000, { ...p, cpmmCreatorFeeToPot: false });
  const rows = [
    ["Traders pay", money(curve.traderPaidUsd), money(grad.traderPaidUsd), money(gradNoCreator.traderPaidUsd)],
    ["Raydium (protocol, fund)", money(curve.raydiumUsd), money(grad.raydiumUsd), money(gradNoCreator.raydiumUsd)],
    ["Creator, paid on-chain directly", money(curve.creatorDirectUsd), money(grad.creatorDirectUsd), money(gradNoCreator.creatorDirectUsd)],
    ["Reaches Divvy's wallets (pot)", money(curve.potUsd), money(grad.potUsd + grad.memeLegCostUsd), money(gradNoCreator.potUsd + gradNoCreator.memeLegCostUsd)],
    ["  of which arrives as the memecoin", money(0), money(grad.memeLegUsd), money(gradNoCreator.memeLegUsd)],
    ["Cost of selling the memecoin leg", money(0), money(grad.memeLegCostUsd), money(gradNoCreator.memeLegCostUsd)],
    ["**Holders' bucket**", `**${money(curve.holdersUsd)}**`, `**${money(grad.holdersUsd)}**`, `**${money(gradNoCreator.holdersUsd)}**`],
    ["Creator share forwarded by Divvy", money(curve.creatorUsd), money(grad.creatorUsd), money(gradNoCreator.creatorUsd)],
    ["**Divvy's share**", `**${money(curve.divvyUsd)}**`, `**${money(grad.divvyUsd)}**`, `**${money(gradNoCreator.divvyUsd)}**`],
  ];
  const drop = 1 - grad.holdersUsd / curve.holdersUsd;
  const dropNo = 1 - gradNoCreator.holdersUsd / curve.holdersUsd;
  return (
    `## 3. Where each $1,000 of volume goes\n\n` +
    table(["Per $1,000 traded", "On the curve", "Graduated (CPMM creator fee → Divvy)", "Graduated (creator fee → creator)"], rows) +
    `\n\nAfter graduation the holders' bucket per dollar traded falls by **${pct(drop, 0)}** (or **${pct(dropNo, 0)}** if \`platform_cp_creator\` is left at the default), ` +
    `and Divvy's share by the same proportion. The memecoin-leg cost assumes each sell is small against the pool.\n`
  );
}

function sectionScenarios(): string {
  let out = `## 4. Single coin, per day\n\nHolders get the bucket after the xStock swap's route fee and price impact ("delivered"). ` +
    `"Per $100" is what a wallet holding $100 of the coin receives (pro-rata among eligible holders). ` +
    `Network costs are paid from Divvy's share. Curve rows sit at ${DEFAULT_PARAMS.curveProgress * 100}% progress, so the market cap is the same in every curve row; ` +
    `a curve coin trading $200k+/day would in practice graduate within hours.\n`;
  for (const solUsd of SOL_PRICES) {
    for (const phase of PHASES) {
      const p = withParams({ solUsd });
      const payRows: string[][] = [];
      const costRows: string[][] = [];
      for (const v of VOLUMES) {
        const d = coinDay({ phase, volume24hUsd: v }, "batchedCredit", p);
        const c = ARCHITECTURES.map((a) => coinDay({ phase, volume24hUsd: v }, a, p));
        payRows.push([
          vol(v),
          vol(d.mcapUsd),
          `${int(d.eligible)} / ${int(d.holders)}`,
          num(d.roundsPerDay),
          money(d.fees.holdersUsd),
          money(d.holdersDeliveredUsd),
          money(d.perHundredPerDayUsd),
          `${money(d.medianHolderUsd)} → ${money(d.medianHolderPerDayUsd)}/day`,
          money(d.fees.divvyUsd),
        ]);
        costRows.push([
          vol(v),
          ...c.map((x) => `${money(x.networkCostUsd)} (${pct(x.costShareOfHolders)})`),
          ...c.map((x) => money(x.divvyNetUsd)),
        ]);
      }
      out += `\n### ${phase === "curve" ? "On the curve" : "After graduation"}, SOL $${solUsd}\n\n`;
      out += table(
        ["24h volume", "Market cap", "Eligible / holders", "Rounds/day", "Holders' bucket", "Delivered", "Per $100 held", "Median eligible holder", "Divvy's share"],
        payRows,
      );
      out += `\n\nDivvy's network cost per day (share of the holders' bucket) and Divvy's net per day:\n\n`;
      out += table(
        ["24h volume", ...ARCHITECTURES.map((a) => `Cost ${SHORT[a]}`), ...ARCHITECTURES.map((a) => `Net ${SHORT[a]}`)],
        costRows,
      );
      out += "\n";
    }
  }
  out += `\n${ARCHITECTURES.map((a) => `${SHORT[a]} = ${ARCH_LABEL[a].slice(4)}`).join("; ")}.\n`;
  return out;
}

function sectionBreakEven(): string {
  const rows: string[][] = [];
  for (const phase of PHASES) {
    for (const solUsd of SOL_PRICES) {
      const p = withParams({ solUsd });
      rows.push([
        `${phase === "curve" ? "Curve" : "Graduated"}, SOL $${solUsd}`,
        ...ARCHITECTURES.map((a) => be(breakEvenVolume(phase, a, p))),
        ...ARCHITECTURES.map((a) => be(volumeForCostShare(phase, a, p, 0.05))),
      ]);
    }
  }
  return (
    `## 5. Break-even 24h volume per coin\n\n` +
    `"Break-even" = the lowest 24h volume from which Divvy's own share (0.10% on the curve) pays all of that coin's network costs, so holders keep their full share. ` +
    `"Costs ≤ 5%" = the lowest volume from which network costs are at most 5% of the holders' bucket. Grid: $100 to $10M.\n\n` +
    table(["Case", ...ARCHITECTURES.map((a) => `Break-even ${SHORT[a]}`), ...ARCHITECTURES.map((a) => `Costs ≤ 5% ${SHORT[a]}`)], rows) +
    "\n\nUnder credit/claim the network cost is tiny at every volume, so the real floor is how often a round can run. " +
    "A round needs the carried holders' bucket to reach MIN_ROUND_USD (architecture-independent):\n\n" +
    sectionRoundFloors() +
    "\n"
  );
}

function sectionRoundFloors(): string {
  const rows: string[][] = [];
  for (const minRoundUsd of [1, 2, 5]) {
    const p = withParams({ minRoundUsd });
    const curvePerUsd = feeBuckets("curve", 1, p).holdersUsd;
    const gradPerUsd = feeBuckets("graduated", 1, p).holdersUsd;
    rows.push([
      `$${minRoundUsd}`,
      vol(minRoundUsd / curvePerUsd),
      vol((24 * minRoundUsd) / curvePerUsd),
      vol(minRoundUsd / gradPerUsd),
      vol((24 * minRoundUsd) / gradPerUsd),
    ]);
  }
  return table(["MIN_ROUND_USD", "Curve: ≥ 1 round/day from", "Curve: hourly from", "Graduated: ≥ 1 round/day from", "Graduated: hourly from"], rows);
}

function sectionPlatform(): string {
  let out = `## 6. Platform totals per day\n\n`;
  const p0 = DEFAULT_PARAMS;
  out += `Live coins get 24h volumes from a lognormal (median ${vol(p0.volumeMedianUsd)}, σ = ${p0.volumeLogSigma}) at evenly spaced quantiles; the top ${pct(p0.graduatedShareOfLive, 0)} by volume are graduated; each coin pays in one of ${p0.numAssets} assets (Zipf popularity). Costs include one platform-vault claim per hour and $${p0.infraUsdPerDay}/day of infra.\n\n`;
  const distRows: string[][] = [];
  for (const n of PLATFORM_SIZES) {
    const coins = platformCoins(n, p0);
    const v = coins.map((c) => c.volume24hUsd).sort((a, b) => a - b);
    const q = (f: number) => v[Math.min(v.length - 1, Math.floor(f * v.length))]!;
    distRows.push([int(n), vol(v[0]!), vol(q(0.5)), vol(q(0.9)), vol(v[v.length - 1]!), vol(v.reduce((a, b) => a + b, 0)), int(coins.filter((c) => c.phase === "graduated").length)]);
  }
  out += table(["Live coins", "Smallest", "Median", "90th pct", "Largest", "Total volume", "Graduated"], distRows) + "\n";
  for (const solUsd of SOL_PRICES) {
    const p = withParams({ solUsd });
    const rows: string[][] = [];
    for (const n of PLATFORM_SIZES) {
      const coins = platformCoins(n, p);
      for (const a of ARCHITECTURES) {
        const d = platformDay(coins, a, p);
        rows.push([
          `${int(n)} ${SHORT[a]}`,
          money(d.holdersDeliveredUsd),
          money(d.divvyRevenueUsd),
          money(d.rentUsd),
          money(d.networkCostUsd),
          money(d.divvyNetUsd),
          `${int(d.coinsPayingHourly)} / ${int(d.coinsPayingDaily)} / ${int(d.coinsPayingLessThanDaily)}`,
          num(d.swapsPerHour),
          `${int(d.jitoRequestsPerHour)} (${num((d.jitoRequestsPerHour / JITO_REQUESTS_PER_HOUR) * 60, 1)} min)`,
          num(d.transfersPerHour, 0),
          num(d.ataCreatesPerDay, 0),
        ]);
      }
    }
    out += `\n### SOL $${solUsd}\n\n`;
    out += table(
      ["Coins, arch", "Delivered to holders", "Divvy revenue", "ATA rent", "All network costs", "Divvy net (after infra)", "Coins paying hourly / ≥ daily / < daily", "Swaps/hour", "Jito req/hour (minutes of the 1 rps budget)", "Transfers/hour", "New ATAs/day"],
      rows,
    );
    out += "\n";
  }
  out += `\nJupiter \`/build\` calls equal swaps per hour; the free key allows ${int(JUPITER_FREE_KEY_REQUESTS_PER_HOUR)}/hour. Jito requests assume one send plus ${p0.jitoPollsPerBundle} status polls per bundle, with one swap per bundle.\n`;
  return out;
}

function sectionSensitivity(): string {
  const cases: [string, Partial<Params>][] = [
    ["Defaults", {}],
    ["Churn 0.25 per turnover", { churnPerTurnover: 0.25 }],
    ["Churn 1.0 per turnover", { churnPerTurnover: 1 }],
    ["Zipf α 1.0 (flatter holders)", { holderZipfAlpha: 1.0 }],
    ["Zipf α 1.5 (more top-heavy)", { holderZipfAlpha: 1.5 }],
    ["Half as many holders", { holdersAt10kMcap: 50 }],
    ["Twice as many holders", { holdersAt10kMcap: 200 }],
    ["Min holder $25", { minHolderUsd: 25 }],
    ["Min holder $50", { minHolderUsd: 50 }],
    ["Curve progress 20%", { curveProgress: 0.2 }],
    ["Curve progress 90%", { curveProgress: 0.9 }],
    ["Post-grad turnover 0.3/day", { gradTurnoverPerDay: 0.3 }],
    ["30% of recipients already have the ATA", { pushAtaPreexistingShare: 0.3, creditAtaShare: 0.3 }],
    ["Jito tip 1,000,000 lamports", { jitoTipLamports: 1_000_000 }],
    ["Priority 1,000,000 µlamports/CU", { priorityMicroLamportsPerCu: 1_000_000 }],
  ];
  const rows: string[][] = [];
  for (const [name, over] of cases) {
    const p = withParams({ solUsd: 150, ...over });
    rows.push([
      name,
      be(breakEvenVolume("curve", "batchedPush", p)),
      be(breakEvenVolume("graduated", "batchedPush", p)),
      be(breakEvenVolume("curve", "perCoinCredit", p)),
      be(breakEvenVolume("graduated", "perCoinCredit", p)),
      be(breakEvenVolume("curve", "batchedCredit", p)),
      be(breakEvenVolume("graduated", "batchedCredit", p)),
    ]);
  }
  let out =
    `## 7. Sensitivity of the break-even volume (SOL $150)\n\n` +
    table(["Change from defaults", "Push, curve", "Push, graduated", "Per-coin credit, curve", "Per-coin credit, graduated", "Batched credit, curve", "Batched credit, graduated"], rows) +
    "\n";

  const mhRows: string[][] = [];
  for (const minHolderUsd of [1, 10, 25, 50, 100]) {
    const p = withParams({ solUsd: 150, minHolderUsd });
    const cells: string[] = [];
    for (const [phase, v] of [["curve", 20_000], ["graduated", 200_000]] as [Phase, number][]) {
      const d = coinDay({ phase, volume24hUsd: v }, "batchedPush", p);
      const held = marketState(phase, v, p).heldUsd;
      cells.push(`${int(d.eligible)} of ${int(d.holders)} (${pct(d.eligibleUsd / held, 0)} of value)`);
    }
    mhRows.push([
      `$${minHolderUsd}`,
      ...cells,
      be(breakEvenVolume("curve", "batchedPush", p)),
      be(breakEvenVolume("graduated", "batchedPush", p)),
    ]);
  }
  out +=
    `\nMinimum holding vs who gets paid and the push break-even (SOL $150). Raising the minimum makes push cheaper by excluding small holders:\n\n` +
    table(["Min holder", "Eligible, curve coin at $20k/day", "Eligible, graduated coin at $200k/day", "Push break-even, curve", "Push break-even, graduated"], mhRows) +
    "\n";

  const tipRows: string[][] = [];
  for (const tip of [1_000, 10_000, 100_000, 1_000_000]) {
    const p = withParams({ solUsd: 150, jitoTipLamports: tip });
    const coins = platformCoins(1_000, p);
    const per = platformDay(coins, "perCoinCredit", p);
    const bat = platformDay(coins, "batchedCredit", p);
    tipRows.push([int(tip), money(per.swapNetworkUsd), money(bat.swapNetworkUsd), money(per.divvyNetUsd), money(bat.divvyNetUsd)]);
  }
  out +=
    `\nJito tip and swap batching, 1,000 live coins, credit delivery, SOL $150 (swap network cost per day and Divvy net per day):\n\n` +
    table(["Tip (lamports)", "Swaps, per-coin", "Swaps, batched", "Divvy net, per-coin", "Divvy net, batched"], tipRows) +
    "\n";
  return out;
}

function sectionThresholds(): string {
  let out = `## 8. Thresholds\n\n`;
  const minRounds = [0.5, 1, 2, 5, 10];
  const rows: string[][] = [];
  for (const solUsd of SOL_PRICES) {
    const p = withParams({ solUsd });
    rows.push([`SOL $${solUsd}, per-coin swap`, ...minRounds.map((m) => pct(swapFixedShare(m, 1, p), 2))]);
    rows.push([`SOL $${solUsd}, batched (10 coins per swap)`, ...minRounds.map((m) => pct(swapFixedShare(m, 10, p), 3))]);
    const pBig = withParams({ solUsd, jitoTipLamports: 1_000_000 });
    rows.push([`SOL $${solUsd}, per-coin, tip 1M lamports`, ...minRounds.map((m) => pct(swapFixedShare(m, 1, pBig), 2))]);
  }
  out += `**MIN_ROUND_USD.** Fixed swap cost as a share of the round (route fee and price impact are proportional and come on top):\n\n`;
  out += table(["Case", ...minRounds.map((m) => `$${m}`)], rows) + "\n";
  const covRows: string[][] = [];
  for (const m of minRounds) {
    const p = withParams({ solUsd: 150, minRoundUsd: m });
    const d = platformDay(platformCoins(1_000, p), "batchedCredit", p);
    covRows.push([`$${m}`, int(d.coinsPayingHourly), int(d.coinsPayingDaily), int(d.coinsPayingLessThanDaily), money(d.networkCostUsd)]);
  }
  out += `\nEffect on a 1,000-coin platform (batched credit, SOL $150):\n\n`;
  out += table(["MIN_ROUND_USD", "Coins paying every hour", "Coins paying at least daily", "Coins paying less than daily", "Network cost/day"], covRows) + "\n";

  const autos = [0.1, 0.5, 1, 5];
  const arows = SOL_PRICES.map((s) => [`SOL $${s}`, ...autos.map((a) => pct(autoPushCostShare(a, withParams({ solUsd: s })), 3))]);
  out += `\n**AUTO_PUSH_MIN_USD.** Network cost of one auto-push to an existing ATA as a share of the amount pushed:\n\n`;
  out += table(["Case", ...autos.map((a) => `$${a}`)], arows) + "\n";

  const frows = SOL_PRICES.map((s) => {
    const p = withParams({ solUsd: s });
    return [`SOL $${s}`, money(lamportsToUsd(unitCosts(p).rentLamports, s)), money(rentFarmMinHolderUsd("curve", p)), money(rentFarmMinHolderUsd("graduated", p))];
  });
  out += `\n**Rent farming under push.** A fresh wallet that buys, waits for one snapshot, gets an ATA funded by Divvy, then sells and closes the ATA profits whenever the rent is worth more than its round-trip trading fees. Holding below these amounts makes the farm profitable:\n\n`;
  out += table(["Case", "Rent per ATA", "Break-even holding, curve (2 × 1.00%)", "Break-even holding, graduated (2 × 0.30%)"], frows) + "\n";

  const crows: string[][] = [];
  for (const phase of PHASES) {
    for (const v of VOLUMES) {
      const cells = SOL_PRICES.map((s) => {
        const d = coinDay({ phase, volume24hUsd: v }, "batchedCredit", withParams({ solUsd: s }));
        const days = d.daysToCoverFirstClaimPer100;
        if (!Number.isFinite(days)) return "never";
        return days < 0.1 ? "< 0.1 days" : `${num(days, 1)} days`;
      });
      crows.push([`${phase === "curve" ? "Curve" : "Graduated"} ${vol(v)}`, ...cells]);
    }
  }
  out += `\n**Claim economics for holders (credit model).** Days of accrual before a $100 holder's credit covers a first claim (ATA rent + 2 signatures + priority); later claims cost only the fee:\n\n`;
  out += table(["Coin, 24h volume", "SOL $150", "SOL $250"], crows) + "\n";
  return out;
}

export function buildReport(): string {
  const p = DEFAULT_PARAMS;
  const head =
    `# Divvy payout economics: model results\n\n` +
    `Generated by \`scripts/economics/simulate.ts\` from \`scripts/economics/model.ts\`. No network calls. ` +
    `Graduation FDV ${num(graduationFdvSol(), 1)} SOL. Everything marked ASSUMPTION in section 1 is a parameter in \`DEFAULT_PARAMS\`.\n\n` +
    `Architectures: ${ARCHITECTURES.map((a) => ARCH_LABEL[a]).join("; ")}. ` +
    `Product defaults used: MIN_ROUND_USD $${p.minRoundUsd}, min holder $${p.minHolderUsd}, AUTO_PUSH_MIN_USD $${p.autoPushMinUsd}.\n`;
  return [head, sectionSources(p), sectionUnitCosts(), sectionFeePer1k(p), sectionScenarios(), sectionBreakEven(), sectionPlatform(), sectionSensitivity(), sectionThresholds()].join("\n");
}

const report = buildReport();
const outPath = resolve(dirname(process.argv[1] ?? "."), "results.md");
writeFileSync(outPath, report);
process.stdout.write(report + `\n\nWrote ${outPath}\n`);
