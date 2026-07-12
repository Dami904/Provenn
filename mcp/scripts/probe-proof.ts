/**
 * Probe: can we fetch a TxODDS Merkle proof of the final goals for a finished
 * match? This is the external dependency settle_with_proof relies on.
 *
 *   npx tsx scripts/probe-proof.ts <fixtureId>
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TxLineClient } from "../src/txline/client.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(REPO_ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

async function main() {
  const fixtureId = process.argv[2] ?? "18222446";
  const env = loadEnv();
  const client = new TxLineClient({ env: "devnet", apiToken: env.TXLINE_API_TOKEN });

  const scores = await client.getScores(fixtureId);
  const gf = scores.find((s) => s.Action === "game_finalised");
  const goals = scores.filter((s) => s.Action === "goal");
  console.log(`fixture ${fixtureId}: ${scores.length} score records, game_finalised seq=${gf?.Seq}, ${goals.length} goal events`);
  const stats = gf?.Stats as Record<string, number> | undefined;
  console.log(`final Stats["1"]=${stats?.["1"]} (P1 goals), Stats["2"]=${stats?.["2"]} (P2 goals)`);

  // Try the stat-validation proof at several plausible seqs.
  const seqs = [gf?.Seq, ...goals.slice(-3).map((g) => g.Seq)].filter((s): s is number => typeof s === "number");
  for (const seq of [...new Set(seqs)]) {
    try {
      const v = await client.getScoreStatValidation(fixtureId, seq, [1, 2]);
      if (process.argv.includes("--raw")) {
        console.log(JSON.stringify(v, null, 1));
        return;
      }
      console.log(`\n✓ proof at seq=${seq}:`);
      console.log(`  ts=${v.ts}  fixtureId=${v.summary?.fixtureId}`);
      console.log(`  statsToProve=${JSON.stringify(v.statsToProve)}`);
      console.log(`  subTreeProof nodes=${v.subTreeProof?.length}  mainTreeProof nodes=${v.mainTreeProof?.length}  statProofs=${v.statProofs?.length}`);
      console.log(`  eventStatRoot present=${!!v.eventStatRoot}  eventStatsSubTreeRoot present=${!!v.summary?.eventStatsSubTreeRoot}`);
      return;
    } catch (e) {
      console.log(`  seq=${seq}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log("\nNo proof retrievable at the tried seqs.");
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
