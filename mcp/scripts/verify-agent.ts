/**
 * Trustless verifier — recompute an agent's track record straight from devnet
 * account data, with no Provenn API and no dashboard in the loop.
 * "Don't trust us, run this."
 *
 *   npx tsx scripts/verify-agent.ts <agent-authority-pubkey>
 *
 * What it proves from raw chain state alone:
 *  - the agent's on-chain cumulative Brier equals the sum of its settled
 *    commits' individual scores (nothing was added or hidden);
 *  - every settled commit's stored brier_bps is EXACTLY one of the two values
 *    the on-chain formula permits for its revealed confidence — so a score
 *    could not have been set to an arbitrary number;
 *  - an unrevealed-but-settled commit scored the maximum 10000 (silence
 *    penalty), exactly as the protocol claims.
 *
 * On the commit hash: the reveal nonce is deliberately NOT persisted on-chain,
 * so the hash cannot be — and need not be — re-derived here. The program itself
 * enforced sha256(borsh(prediction) || nonce) == commit_hash at reveal time;
 * a `revealed = true` flag on-chain is that enforcement having passed.
 */
import { PublicKey } from "@solana/web3.js";
import { ProvennChainClient } from "../src/chain/provenn.js";

const MAX_BRIER = 10_000;
const OUTCOMES = ["home", "draw", "away"] as const;

/** The two brier_bps values the on-chain formula allows for a revealed pick. */
function allowedBriers(confidenceBps: number): [number, number] {
  const p = confidenceBps;
  const correct = Math.floor(((MAX_BRIER - p) * (MAX_BRIER - p)) / MAX_BRIER);
  const wrong = Math.floor((p * p) / MAX_BRIER);
  return [correct, wrong];
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: npx tsx scripts/verify-agent.ts <agent-authority-pubkey>");
    process.exit(1);
  }
  let authority: PublicKey;
  try {
    authority = new PublicKey(arg);
  } catch {
    console.error(`not a valid pubkey: ${arg}`);
    process.exit(1);
  }

  const chain = ProvennChainClient.connectReadOnly();
  const agentPda = chain.agentPda(authority);
  const agent = await chain.fetchAgent(authority);
  if (!agent) {
    console.error(`no agent registered for authority ${authority.toString()}`);
    process.exit(1);
  }

  const commits = (await chain.allCommits())
    .filter((c) => c.agent.equals(agentPda))
    .sort((a, b) => Number(a.slot - b.slot));

  console.log(`Agent:     ${agent.name}`);
  console.log(`Authority: ${authority.toString()}`);
  console.log(`Agent PDA: ${agentPda.toString()}`);
  console.log(
    `On-chain:  total_commits=${agent.totalCommits}  revealed=${agent.revealedCount}  cumulative_brier_bps=${agent.cumulativeBrierBps}`,
  );
  console.log(`Commits found on program for this agent: ${commits.length}`);
  console.log("");

  let sum = 0n;
  let settledCount = 0;
  let allConsistent = true;

  for (const c of commits) {
    const state = !c.settled ? "unsettled" : c.revealed ? "settled" : "unrevealed→loss";
    let note = "";
    if (c.settled) {
      settledCount++;
      sum += c.brierBps;
      if (!c.revealed) {
        const ok = c.brierBps === BigInt(MAX_BRIER);
        allConsistent &&= ok;
        note = ok ? "brier = 10000 (silence penalty) ✓" : `EXPECTED 10000, got ${c.brierBps} ✗`;
      } else {
        const [correct, wrong] = allowedBriers(c.prediction.confidence_bps);
        const ok = c.brierBps === BigInt(correct) || c.brierBps === BigInt(wrong);
        allConsistent &&= ok;
        const which = c.brierBps === BigInt(correct) ? "correct pick" : c.brierBps === BigInt(wrong) ? "wrong pick" : "??";
        note = ok
          ? `brier ${c.brierBps} ∈ {${correct}(correct), ${wrong}(wrong)} @ p=${c.prediction.confidence_bps} → ${which} ✓`
          : `brier ${c.brierBps} ∉ {${correct}, ${wrong}} @ p=${c.prediction.confidence_bps} ✗`;
      }
    }
    const pick = c.revealed ? OUTCOMES[c.prediction.outcome] ?? `?${c.prediction.outcome}` : "sealed";
    console.log(`  match ${c.matchId}  [${state}]  pick=${pick}  ${note}`);
  }

  console.log("");
  const cumulativeMatches = sum === agent.cumulativeBrierBps;
  console.log(
    `Recomputed Σ brier_bps over ${settledCount} settled = ${sum}   vs on-chain cumulative = ${agent.cumulativeBrierBps}   ${cumulativeMatches ? "MATCH ✓" : "MISMATCH ✗"}`,
  );
  if (settledCount > 0) {
    const meanSettled = Number(sum) / settledCount / MAX_BRIER;
    console.log(`Mean Brier over settled commits: ${meanSettled.toFixed(4)}  (0 = perfect, 1 = maximally wrong)`);
  }
  if (agent.totalCommits > 0n) {
    // The dashboard/leaderboard divide by total_commits (unsettled count as 0);
    // shown here too so the two definitions are transparent.
    const meanTotal = Number(agent.cumulativeBrierBps) / Number(agent.totalCommits) / MAX_BRIER;
    console.log(`Mean Brier over total commits (dashboard convention): ${meanTotal.toFixed(4)}`);
  }

  console.log("");
  console.log(
    cumulativeMatches && allConsistent
      ? "VERIFIED ✓  Every score was recomputed from raw account data and is consistent with the protocol formula. You did not have to trust the Provenn API or dashboard for any of this."
      : "INCONSISTENCY DETECTED ✗  See the ✗ lines above — the on-chain record does not match the protocol formula.",
  );
  console.log(
    "\nNote: the reveal nonce is intentionally not stored on-chain, so the commit hash is not re-derived here; the program enforced sha256(prediction‖nonce)==commit_hash at reveal time (a `revealed` flag means that check passed).",
  );
  process.exit(cumulativeMatches && allConsistent ? 0 : 2);
}

void main();
