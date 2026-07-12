/**
 * Exercise the TRUSTLESS settlement path end to end against a real, finished
 * World Cup match: commit -> reveal -> settle_with_proof, where the outcome is
 * proven by a TxODDS Merkle proof (no admin asserts the result).
 *
 *   npx tsx scripts/exercise-settle-proof.ts <fixtureId>
 *
 * Note on timing: for a completed match we commit now (after the fact) purely
 * to demonstrate the trustless-settlement machinery. In live operation the
 * commit lands before kickoff (see the runner); here the point is to prove the
 * on-chain CPI to the TxODDS oracle validates the score.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProvennChainClient } from "../src/chain/provenn.js";
import { commitHash, outcomeFromScore, type Prediction } from "../src/agent/prediction.js";
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
const ex = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

async function main(): Promise<void> {
  const fixtureId = process.argv[2] ?? "18213979";
  const env = loadEnv();
  const feed = new TxLineClient({ env: "devnet", apiToken: env.TXLINE_API_TOKEN });
  const chain = ProvennChainClient.connect();
  const matchId = BigInt(fixtureId);

  // 1. Resolve the real outcome + the proof seq from the finished match.
  const scores = await feed.getScores(fixtureId);
  const gf = scores.find((s) => s.Action === "game_finalised");
  const actualOutcome = outcomeFromScore(scores);
  if (actualOutcome === undefined || !gf) {
    throw new Error(`fixture ${fixtureId} has no final score yet`);
  }
  const seq = gf.Seq as number;
  console.log(`Match ${fixtureId}: final outcome = ${["P1 win", "draw", "P2 win"][actualOutcome]} (proof seq ${seq})`);

  // 2. Agent must exist.
  const agent = await chain.fetchAgent();
  if (!agent) throw new Error("no agent registered for this wallet — run run-agent.ts --register first");
  console.log(`Agent ${agent.name} — cumulative_brier_bps before: ${agent.cumulativeBrierBps}`);

  // 3. Commit a prediction (predict the actual outcome, high confidence) unless
  //    a commit already exists for this match.
  const existing = await chain.fetchCommit(matchId).catch(() => undefined);
  const prediction: Prediction = { outcome: actualOutcome, confidence_bps: 7000 };
  const nonce = randomBytes(32);
  if (!existing) {
    const hash = commitHash(prediction, nonce);
    const commitTx = await chain.commit(matchId, hash, 0n);
    console.log(`commit:  ${commitTx}\n         ${ex(commitTx)}`);
    const revealTx = await chain.reveal(matchId, prediction, nonce);
    console.log(`reveal:  ${revealTx}\n         ${ex(revealTx)}`);
  } else {
    console.log(`commit already exists for match ${fixtureId} (revealed=${existing.revealed}, settled=${existing.settled})`);
    if (existing.settled) throw new Error("already settled — pick a different match");
  }

  // 4. Fetch the TxODDS Merkle proof of the two goal stats.
  const validation = await feed.getScoreStatValidation(fixtureId, seq, [1, 2]);
  console.log(`proof:   goals P1=${validation.statsToProve[0]?.value} P2=${validation.statsToProve[1]?.value}, ` +
    `${validation.subTreeProof.length}+${validation.mainTreeProof.length} proof nodes`);

  // 5. Settle trustlessly — the program CPIs the TxODDS oracle to verify.
  const settleTx = await chain.settleWithProof(matchId, actualOutcome, validation);
  console.log(`\n✓ settle_with_proof: ${settleTx}\n  ${ex(settleTx)}`);

  const after = await chain.fetchAgent();
  const commit = await chain.fetchCommit(matchId);
  console.log(`\nAgent cumulative_brier_bps after: ${after?.cumulativeBrierBps}`);
  console.log(`This commit: settled=${commit?.settled} brier_bps=${commit?.brierBps} (0=perfect, 10000=worst)`);
}

void main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
