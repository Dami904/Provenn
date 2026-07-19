import type { ReactNode } from "react";

/* ============================================================
   Docs content — every page is data, rendered by pages/Docs.tsx.
   Sections get an `id` so the right-hand "On this page" TOC and
   #anchor links work. Keep bodies plain JSX (no markdown dep).
   ============================================================ */

export type DocSection = {
  id: string;
  title: string;
  body: ReactNode;
};

export type DocPage = {
  /** URL slug under /docs — "" is the index page. */
  slug: string;
  group: string;
  title: string;
  /** One-line lede under the title; also used by search. */
  description: string;
  sections: DocSection[];
};

function Code({ children }: { children: string }) {
  return (
    <pre className="doc-code">
      <code>{children.trim()}</code>
    </pre>
  );
}

const PROGRAM_ID = "Ayfm8HcwaMTXFVxc3zTvXBcLAu57tHc4gVKMgE1wSpr2";
const EXPLORER = `https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`;

export const DOC_PAGES: DocPage[] = [
  /* ---------------- Overview ---------------- */
  {
    slug: "",
    group: "Overview",
    title: "Introduction",
    description:
      "Trading agents whose track records can't be faked — a mandatory-reveal commit ledger with Brier scoring on Solana.",
    sections: [
      {
        id: "the-problem",
        title: "The problem",
        body: (
          <>
            <p>
              Anyone can claim a great trading record; nobody can verify it wasn't fabricated after
              the fact. Timestamping single calls isn't enough — <em>hidden losses do the lying</em>.
            </p>
            <p>
              Provenn's rule: an agent registers one on-chain identity, <strong>every</strong>{" "}
              committed prediction must be revealed by settlement, and an unrevealed commit
              automatically scores as a maximum-loss Brier. Silence is penalized, so the complete
              record — wins and losses — is structurally impossible to hide.
            </p>
          </>
        ),
      },
      {
        id: "choose-your-path",
        title: "Choose your path",
        body: (
          <div className="doc-cards">
            <a href="/docs/register-your-agent" className="doc-card" data-internal>
              <b>Agent builders</b>
              <span>Register your own agent on the devnet program and compete on the public leaderboard.</span>
            </a>
            <a href="/docs/mcp-server" className="doc-card" data-internal>
              <b>Developers</b>
              <span>Use the MCP tools, public API, or read the chain directly — no permission needed.</span>
            </a>
            <a href="/docs/how-it-works" className="doc-card" data-internal>
              <b>Curious readers</b>
              <span>Understand the commit → reveal → settle loop that makes records unfakeable.</span>
            </a>
            <a href="/docs/trust-model" className="doc-card" data-internal>
              <b>Skeptics</b>
              <span>Exactly what is proven, what is not, and how to verify everything yourself.</span>
            </a>
          </div>
        ),
      },
      {
        id: "what-provenn-is",
        title: "What Provenn is",
        body: (
          <>
            <p>
              Provenn is an <strong>open protocol</strong> on Solana devnet (program{" "}
              <a href={EXPLORER} target="_blank" rel="noreferrer">
                <code>Ayfm…Spr2</code>
              </a>
              ), fed by live TxLINE World Cup odds. A deterministic drift detector watches the feed;
              when a signal fires, the prediction is hash-committed on-chain <em>before</em> the
              outcome is known, revealed after the match, and scored with a Brier score that
              accumulates on the agent's public account.
            </p>
            <p>
              The decision logic is pure math — odds drift vs. implied probability over a window,
              fixed thresholds, no LLM in the loop — so every signal is independently reproducible
              from the same feed data.
            </p>
          </>
        ),
      },
      {
        id: "key-terms",
        title: "Key terms",
        body: (
          <div className="doc-table-scroll">
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Term</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Commit</td>
                  <td>
                    <code>sha256(prediction ‖ nonce)</code> stored on-chain before the outcome
                    exists, stamped with slot + timestamp.
                  </td>
                </tr>
                <tr>
                  <td>Reveal</td>
                  <td>
                    The plaintext prediction + nonce, published after the match; the program checks
                    it against the committed hash.
                  </td>
                </tr>
                <tr>
                  <td>Settle</td>
                  <td>
                    The real outcome is recorded and the commit's Brier score is fixed. Unrevealed
                    commits settle as maximum loss.
                  </td>
                </tr>
                <tr>
                  <td>Brier score</td>
                  <td>
                    Accuracy measure in basis points, 0 (perfect) to 10000 (worst). Lower is better.
                  </td>
                </tr>
                <tr>
                  <td>Stake</td>
                  <td>
                    Optional lamports escrowed per commit; refunded accuracy-weighted at settlement,
                    remainder slashed to the treasury.
                  </td>
                </tr>
                <tr>
                  <td>Strategy hash</td>
                  <td>
                    A 32-byte hash of the agent's strategy source, bound to its identity forever at
                    registration.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ),
      },
      {
        id: "try-it",
        title: "Try it in under a minute",
        body: (
          <>
            <p>No TxLINE token and no local install for the first look:</p>
            <ul>
              <li>
                <a href="/dashboard?demo">Demo dashboard</a> — canned sample data: leaderboard,
                probability charts, commit ledger.
              </li>
              <li>
                <a href="/dashboard" data-internal>
                  Live dashboard
                </a>{" "}
                — real on-chain agents when the runner has been active.
              </li>
              <li>
                Public API — the same numbers the UI renders, so you can prove it isn't faked
                client-side:
              </li>
            </ul>
            <Code>{`
curl https://provenn.onrender.com/api/agents
curl https://provenn.onrender.com/api/commits
curl https://provenn.onrender.com/api/log
`}</Code>
          </>
        ),
      },
    ],
  },
  {
    slug: "how-it-works",
    group: "Overview",
    title: "How it works",
    description:
      "The four-step loop — watch, commit, reveal, settle — that turns predictions into an unfakeable public record.",
    sections: [
      {
        id: "the-loop",
        title: "The loop",
        body: (
          <ol className="doc-steps">
            <li>
              <b>Watch</b> — the agent polls TxLINE live World Cup odds (demargined consensus
              prices) and runs a deterministic drift detector: same feed in, same signal out. An
              integrity gate refuses to act on stale or glitchy data.
            </li>
            <li>
              <b>Commit</b> — when a signal fires, <code>sha256(prediction ‖ nonce)</code> is
              committed on-chain <em>before</em> the outcome is known. The program stores the slot
              and timestamp — the "before the fact" proof.
            </li>
            <li>
              <b>Reveal</b> — after the match, the plaintext prediction + nonce are revealed; the
              program verifies the hash matches the commit.
            </li>
            <li>
              <b>Settle</b> — the outcome is recorded and the agent's cumulative Brier score updates
              on-chain. Unrevealed commits settle as losses.
            </li>
          </ol>
        ),
      },
      {
        id: "commit",
        title: "Commit",
        body: (
          <>
            <p>
              Before the outcome is known, the agent submits{" "}
              <code>commit(match_id, prediction_hash, stake)</code>. The chain stamps the commit with
              its own slot and unix timestamp. <code>match_id</code> maps to the TxLINE match id, and
              the commit PDA (<code>["commit", agent, match_id]</code>) means an agent can commit{" "}
              <strong>once per match</strong> — no committing twice and keeping the winner.
            </p>
            <p>The hash the later reveal must satisfy is:</p>
            <Code>{`
prediction_hash == sha256( borsh(Prediction) || nonce )

Prediction { outcome: u8, confidence_bps: u16 }   // 3 bytes, little-endian
byte 0      outcome          (0 = home, 1 = draw, 2 = away)
bytes 1..3  confidence_bps   (u16 LE, 0..=10000)
`}</Code>
            <p>
              The nonce is any-length bytes; the reference implementation uses 32 random bytes and
              persists them. Lose the nonce and you cannot reveal — which means an automatic
              max-loss settle.
            </p>
          </>
        ),
      },
      {
        id: "reveal",
        title: "Reveal",
        body: (
          <>
            <p>
              <code>reveal(match_id, prediction, nonce)</code> publishes the plaintext. Constraints:
              not already revealed, not yet settled, <code>outcome ≤ 2</code>,{" "}
              <code>confidence_bps ≤ 10000</code>, and the hash must match. Revealing after
              settlement is rejected (<code>RevealAfterSettle</code>).
            </p>
            <p>
              There is no earliest-reveal restriction on-chain — but revealing early leaks your
              position, so reveal after the match ends and <strong>before settlement</strong>.
            </p>
          </>
        ),
      },
      {
        id: "settle",
        title: "Settle",
        body: (
          <>
            <p>
              Preferably anyone (including the agent) calls <code>settle_with_proof</code> with a
              TxODDS Merkle proof of the final score; the admin <code>settle</code> is the fallback.
              Either way the commit's <code>brier_bps</code> is fixed and added to the agent's
              cumulative score, and any stake is refunded accuracy-weighted. Unrevealed at this
              moment = 10000 bps and a fully slashed stake, no appeal. See{" "}
              <a href="/docs/trustless-settlement" data-internal>
                Trustless settlement
              </a>
              .
            </p>
          </>
        ),
      },
      {
        id: "timing",
        title: "Timing note",
        body: (
          <p>
            The chain proves <em>when</em> you committed (slot + timestamp); it does not enforce that
            the commit precedes kickoff. Verifiers compare your commit timestamp against the match
            start — commits after kickoff are visible to everyone and worth nothing.
          </p>
        ),
      },
    ],
  },

  /* ---------------- Concepts ---------------- */
  {
    slug: "brier-scoring",
    group: "Concepts",
    title: "Brier scoring",
    description:
      "How predictions are graded on-chain: a two-outcome Brier score in basis points, where lower is better and silence costs the maximum.",
    sections: [
      {
        id: "prediction-shape",
        title: "What a prediction is",
        body: (
          <p>
            A prediction is a pick (<code>outcome</code>: 0 = home, 1 = draw, 2 = away) plus a
            confidence <code>p</code> in basis points (0..=10000). The program deliberately collapses
            the 3-way market to a two-outcome Brier score on your pick — you stake <code>p</code> on
            your pick and implicitly <code>10000 − p</code> on "not my pick".
          </p>
        ),
      },
      {
        id: "score-table",
        title: "The score table",
        body: (
          <>
            <div className="doc-table-scroll">
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>
                      <code>brier_bps</code> (lower is better)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Revealed, pick correct</td>
                    <td>
                      <code>(10000 − p)² / 10000</code>
                    </td>
                  </tr>
                  <tr>
                    <td>Revealed, pick wrong</td>
                    <td>
                      <code>p² / 10000</code>
                    </td>
                  </tr>
                  <tr>
                    <td>Unrevealed at settle</td>
                    <td>
                      <code>10000</code> — the maximum possible loss
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              <code>cumulative_brier_bps</code> accumulates on the agent account; mean Brier =
              cumulative / settled commits. All of it is recomputable from raw accounts — you never
              have to trust the API.
            </p>
          </>
        ),
      },
      {
        id: "stakes",
        title: "Optional stake — skin in the game",
        body: (
          <p>
            <code>commit</code> takes a <code>stake</code> in lamports (0 is fine), escrowed in a
            per-commit PDA. Settlement refunds <code>stake × (10000 − brier) / 10000</code> and
            slashes the rest to the protocol treasury — so a wrong or hidden call costs real
            capital, not just reputation. An unrevealed commit (Brier 10000) loses the whole stake.
          </p>
        ),
      },
    ],
  },
  {
    slug: "trustless-settlement",
    group: "Concepts",
    title: "Trustless settlement",
    description:
      "settle_with_proof removes the trusted admin: match results are proven against TxODDS's on-chain Merkle roots via CPI.",
    sections: [
      {
        id: "why",
        title: "The problem it solves",
        body: (
          <p>
            The original <code>settle(match_id, actual_outcome)</code> is gated on a hardcoded{" "}
            <code>SETTLE_AUTHORITY</code> admin signer that simply <em>asserts</em> the result — the
            one trusted party in the system. <code>settle_with_proof</code> removes it: the match
            result is proven against TxODDS's own on-chain data anchoring, so settlement needs no
            trusted operator.
          </p>
        ),
      },
      {
        id: "paths",
        title: "Live vs. fallback",
        body: (
          <div className="doc-table-scroll">
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Trust</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>settle_with_proof(...)</code>
                  </td>
                  <td>Trustless — CPIs TxODDS's on-chain oracle to verify a Merkle proof of final goals</td>
                  <td>
                    <strong>Default</strong> on the live feed; exercised end-to-end on devnet against
                    a real finished match (Norway 1–2 England, fixture <code>18213979</code>)
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>settle(match_id, outcome)</code>
                  </td>
                  <td>
                    Trusts a <code>SETTLE_AUTHORITY</code> signer
                  </td>
                  <td>Fallback — used when no proof is available or the proof call fails</td>
                </tr>
              </tbody>
            </table>
          </div>
        ),
      },
      {
        id: "mechanics",
        title: "How the proof works",
        body: (
          <>
            <p>
              TxODDS canonicalizes its feed into Merkle trees and publishes daily roots in PDAs on
              its devnet program <code>txoracle</code>. Its <code>validate_stat_v2</code> instruction
              returns <code>true</code> iff a supplied record + Merkle proof hashes up to the
              anchored root <em>and</em> a caller-supplied predicate over the proven stats holds.
            </p>
            <ol>
              <li>
                The client fetches the proof — full-time home-goals and away-goals stats plus their
                Merkle proofs — and maps it into the program's <code>StatValidationInput</code>.
              </li>
              <li>
                The program binds the proof to the commit's match (<code>fixture_id == match_id</code>)
                and checks the two stats are exactly the pinned goal stats.
              </li>
              <li>
                The program builds — itself, not the caller — the predicate that is true iff the
                asserted outcome happened, over <code>home_goals − away_goals</code>.
              </li>
              <li>
                It CPIs <code>validate_stat_v2</code>, which recomputes the Merkle root and evaluates
                the predicate; the program requires <code>true</code>, then runs the same Brier
                scoring as <code>settle</code>.
              </li>
            </ol>
            <p>
              Because the predicate is built inside Provenn and the goal stats are proven against
              TxODDS's root, neither the caller nor any admin can assert a false result: a wrong{" "}
              <code>actual_outcome</code> aborts with <code>OutcomeNotProven</code>. Anyone can
              trigger settlement once TxODDS has anchored the final score — a grace period stops
              third parties from force-settling a still-unrevealed commit before the reveal lands.
            </p>
            <p>
              Reproduce the devnet proof yourself:{" "}
              <code>npx tsx scripts/exercise-settle-proof.ts &lt;fixtureId&gt;</code>
            </p>
          </>
        ),
      },
    ],
  },
  {
    slug: "trust-model",
    group: "Concepts",
    title: "Trust model",
    description: "Exactly what Provenn proves, what it doesn't, and how to verify it all yourself.",
    sections: [
      {
        id: "proven",
        title: "What is proven",
        body: (
          <p>
            <strong>Timing and completeness.</strong> Every call was fixed before the outcome
            existed (slot + timestamp on the commit), and no call can be hidden — an unrevealed
            commit settles as a maximum loss, so the record you see is the complete one.
          </p>
        ),
      },
      {
        id: "not-proven",
        title: "What is not proven",
        body: (
          <p>
            <strong>Computation integrity.</strong> Nothing verifies that the registered strategy
            hash matches the code that actually produced a prediction — that would require a ZK
            proof of execution, which is out of scope. Settlement is trustless when it goes through{" "}
            <code>settle_with_proof</code>; only the fallback <code>settle</code> path trusts the
            single <code>SETTLE_AUTHORITY</code> key.
          </p>
        ),
      },
      {
        id: "verify",
        title: "Verify it yourself",
        body: (
          <>
            <p>
              The deterministic detector means every signal is independently recomputable from the
              same feed data, and every account is a plain devnet account:
            </p>
            <Code>{`
# any agent's on-chain record, straight from the chain
npx tsx scripts/verify-agent.ts <pubkey>

# your own agent account, as anyone would read it
cd mcp && npx tsx scripts/agent-status.ts
`}</Code>
            <p>
              Or read the raw accounts on the{" "}
              <a href={EXPLORER} target="_blank" rel="noreferrer">
                Solana explorer
              </a>
              : mean Brier = <code>cumulative_brier_bps / settled commits</code>;{" "}
              <code>total_commits − revealed_count</code> is the auto-loss count.
            </p>
          </>
        ),
      },
    ],
  },

  /* ---------------- For agent builders ---------------- */
  {
    slug: "register-your-agent",
    group: "For agent builders",
    title: "Register your agent",
    description:
      "Provenn is an open protocol — anyone can register an agent on the devnet program and start building an unfakeable record.",
    sections: [
      {
        id: "rules",
        title: "The rules (the protocol contract)",
        body: (
          <>
            <p>
              Everything below is enforced by the on-chain program, deployed on Solana devnet at{" "}
              <code className="doc-break">{PROGRAM_ID}</code>.
            </p>
            <ol>
              <li>
                <b>One identity per wallet.</b> Your agent account is a PDA at{" "}
                <code>["agent", authority]</code> — one per authority keypair. Registration binds a
                32-byte <code>strategy_hash</code> to it forever; changing strategy means a new
                wallet and a fresh record.
              </li>
              <li>
                <b>One commit per match.</b> The commit PDA is <code>["commit", agent, match_id]</code>{" "}
                — you cannot commit twice to the same match and keep the winner.
              </li>
              <li>
                <b>Mandatory reveal.</b> Every commit must be revealed before it is settled; an
                unrevealed commit settles at <code>brier_bps = 10000</code>.
              </li>
              <li>
                <b>Brier scoring</b> exactly as in{" "}
                <a href="/docs/brier-scoring" data-internal>
                  Brier scoring
                </a>
                .
              </li>
              <li>
                <b>Optional stake</b> — escrowed per commit, refunded accuracy-weighted.
              </li>
              <li>
                <b>Two settlement paths</b> — see{" "}
                <a href="/docs/trustless-settlement" data-internal>
                  Trustless settlement
                </a>
                .
              </li>
            </ol>
          </>
        ),
      },
      {
        id: "five-minutes",
        title: "Register in 5 minutes",
        body: (
          <Code>{`
git clone https://github.com/Dami904/Provenn.git provenn && cd provenn
npm install

# a devnet wallet — either a keypair file...
solana-keygen new --outfile ~/.config/solana/id.json   # skip if you have one
solana airdrop 2 --url devnet                          # rent for the PDAs
# ...or, for cloud deploys, set WALLET_KEYPAIR to the JSON secret-key byte array:
# export WALLET_KEYPAIR='[12,34,...]'
`}</Code>
        ),
      },
      {
        id: "option-a",
        title: "Option A — reuse the TypeScript client",
        body: (
          <>
            <p>
              <code>ProvennChainClient</code> (<code>mcp/src/chain/provenn.ts</code>) wraps the
              program with the bundled IDL. <code>connect()</code> picks up{" "}
              <code>WALLET_KEYPAIR</code> or <code>~/.config/solana/id.json</code> automatically.
            </p>
            <Code>{`
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ProvennChainClient } from "./mcp/src/chain/provenn.js";

const chain = ProvennChainClient.connect(); // devnet RPC + your wallet

// Hash your strategy source — your public, permanent strategy commitment.
const strategyHash = new Uint8Array(
  createHash("sha256").update(readFileSync("path/to/your-strategy.ts")).digest(),
);

const tx = await chain.registerAgent("my-agent", strategyHash); // name ≤ 32 bytes
console.log(\`registered: https://explorer.solana.com/tx/\${tx}?cluster=devnet\`);
`}</Code>
          </>
        ),
      },
      {
        id: "option-b",
        title: "Option B — raw Anchor, any language",
        body: (
          <>
            <p>
              No TypeScript required — target the program directly with the IDL at{" "}
              <code>mcp/src/idl/provenn_protocol.json</code>.
            </p>
            <div className="doc-table-scroll">
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>Instruction</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>register_agent(name, strategy_hash)</code>
                    </td>
                    <td>
                      accounts: <code>agent</code> (PDA, init), <code>authority</code> (signer,
                      payer), <code>system_program</code>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <code>commit(match_id, prediction_hash, stake)</code>
                    </td>
                    <td>
                      accounts: <code>agent</code>, <code>commit</code> (PDA, init),{" "}
                      <code>escrow</code> (PDA, init), <code>authority</code>,{" "}
                      <code>system_program</code>; <code>stake</code> may be 0
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <code>reveal(match_id, prediction, nonce)</code>
                    </td>
                    <td>
                      accounts: <code>agent</code>, <code>commit</code>, <code>authority</code>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <code>settle(match_id, actual_outcome)</code>
                    </td>
                    <td>
                      admin fallback, <code>SETTLE_AUTHORITY</code> only
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <code>settle_with_proof(match_id, actual_outcome, payload)</code>
                    </td>
                    <td>trustless; verifies a TxODDS Merkle proof via CPI</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>PDA seeds and account layouts:</p>
            <Code>{`
agent:  ["agent", authority_pubkey]
commit: ["commit", agent_pda, match_id.to_le_bytes()]   // u64 LE, 8 bytes
escrow: ["stake", commit_pda]

AgentAccount:  authority: Pubkey, name: String (≤32), strategy_hash: [u8;32],
               total_commits: u64, revealed_count: u64,
               cumulative_brier_bps: u64, bump: u8
CommitAccount: agent: Pubkey, match_id: u64, prediction_hash: [u8;32],
               slot: u64, unix_timestamp: i64, revealed: bool, settled: bool,
               prediction: Prediction, brier_bps: u64, bump: u8
`}</Code>
          </>
        ),
      },
      {
        id: "reading-your-score",
        title: "Reading your score",
        body: (
          <>
            <p>
              The moment your registration lands you're on the leaderboard —{" "}
              <code>GET /api/agents</code> ranks every registered agent by mean Brier, and the{" "}
              <a href="/dashboard" data-internal>
                dashboard
              </a>{" "}
              shows you alongside everyone else. Your agent PDA and every commit/reveal tx are plain
              devnet accounts on the explorer.
            </p>
            <Code>{`
cd mcp && npx tsx scripts/agent-status.ts   # your on-chain AgentAccount`}</Code>
          </>
        ),
      },
    ],
  },

  /* ---------------- For developers ---------------- */
  {
    slug: "mcp-server",
    group: "For developers",
    title: "MCP server",
    description:
      "The TxLINE feed and the deterministic odds-shift detector, exposed as MCP tools — remote Connector or local stdio.",
    sections: [
      {
        id: "tools",
        title: "The tools",
        body: (
          <div className="doc-table-scroll">
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>get_match_schedule</code>
                  </td>
                  <td>List upcoming and live World Cup fixtures from the TxLINE feed</td>
                </tr>
                <tr>
                  <td>
                    <code>get_live_odds</code>
                  </td>
                  <td>
                    Current odds snapshot for a match; also accumulates in-memory history for the
                    detector
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>get_match_events</code>
                  </td>
                  <td>Score / match events (goals, kickoff, full time) for a match</td>
                </tr>
                <tr>
                  <td>
                    <code>detect_odds_shift</code>
                  </td>
                  <td>
                    Run the drift detector over accumulated odds history — integrity gate first;
                    fires when any outcome's implied probability moves ≥ <code>threshold_pct</code>{" "}
                    within <code>window_seconds</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ),
      },
      {
        id: "remote",
        title: "Remote Connector (no install)",
        body: (
          <>
            <p>
              For Claude, Claude Desktop, or any MCP client that takes a URL — the tools run against
              the live TxLINE feed server-side, so no API token is needed on your end:
            </p>
            <Code>{`https://provenn.onrender.com/mcp`}</Code>
            <p>
              Settings → Connectors → <em>Add custom connector</em> → paste the URL. That's it.
            </p>
          </>
        ),
      },
      {
        id: "local",
        title: "Local stdio",
        body: (
          <>
            <p>
              For MCP clients that launch a subprocess. Live tools need{" "}
              <code>TXLINE_API_TOKEN</code> in the environment (see{" "}
              <a href="/docs/running-locally" data-internal>
                Running locally
              </a>
              ):
            </p>
            <Code>{`
{ "mcpServers": { "provenn": {
  "command": "npx", "args": ["tsx", "mcp/src/index.ts"],
  "env": { "TXLINE_API_TOKEN": "..." }
} } }
`}</Code>
          </>
        ),
      },
      {
        id: "trust-boundary",
        title: "Trust boundary",
        body: (
          <p>
            These tools are <strong>read/analyze only</strong> (feed + detector) — no
            commit/reveal/settle instruction is exposed over MCP, so a connected client can never
            move funds or touch the on-chain ledger. Both entrypoints (stdio and the remote
            Connector) build the identical tool set from <code>mcp/src/mcpServer.ts</code>.
          </p>
        ),
      },
    ],
  },
  {
    slug: "public-api",
    group: "For developers",
    title: "Public API",
    description:
      "The same numbers the dashboard renders, served as JSON — so anyone can check the UI isn't faking it.",
    sections: [
      {
        id: "endpoints",
        title: "Endpoints",
        body: (
          <>
            <div className="doc-table-scroll">
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>Endpoint</th>
                    <th>Returns</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>GET /api/agents</code>
                    </td>
                    <td>Every registered agent, ranked by mean Brier</td>
                  </tr>
                  <tr>
                    <td>
                      <code>GET /api/agent</code>
                    </td>
                    <td>One agent's on-chain record</td>
                  </tr>
                  <tr>
                    <td>
                      <code>GET /api/commits</code>
                    </td>
                    <td>The full public commit ledger, every agent</td>
                  </tr>
                  <tr>
                    <td>
                      <code>GET /api/log</code>
                    </td>
                    <td>The runner's event log (signals, commits, integrity skips)</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Code>{`
curl https://provenn.onrender.com/api/agents
curl https://provenn.onrender.com/api/commits
curl https://provenn.onrender.com/api/log
`}</Code>
            <p>
              Locally, <code>npx tsx mcp/scripts/serve-api.ts</code> serves the same endpoints on
              port 8787. The TypeScript client exposes them as <code>allAgents()</code> /{" "}
              <code>allCommits()</code>.
            </p>
          </>
        ),
      },
      {
        id: "dont-trust-us",
        title: "Don't trust the API",
        body: (
          <p>
            Everything the API serves is recomputable from raw devnet accounts:{" "}
            <code>npx tsx scripts/verify-agent.ts &lt;pubkey&gt;</code> reads any agent's record
            straight from the chain, and the{" "}
            <a href={EXPLORER} target="_blank" rel="noreferrer">
              explorer
            </a>{" "}
            shows every commit and reveal tx. The API is a convenience, not a source of truth.
          </p>
        ),
      },
    ],
  },
  {
    slug: "running-locally",
    group: "For developers",
    title: "Running locally",
    description: "Monorepo layout, quickstart, replays that need no credentials, and the test suite.",
    sections: [
      {
        id: "layout",
        title: "Monorepo layout",
        body: (
          <div className="doc-table-scroll">
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Directory</th>
                  <th>What it is</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>mcp/</code>
                  </td>
                  <td>
                    TypeScript MCP server + agent runner — TxLINE feed client, deterministic signal
                    detection, feed capture/replay, Solana chain client
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>program/</code>
                  </td>
                  <td>
                    Anchor (Rust) Solana program — agent registry, commit-reveal ledger, Brier
                    scoring
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>app/</code>
                  </td>
                  <td>
                    Vite + React dashboard — live watch, commit ledger with proof links, leaderboard
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ),
      },
      {
        id: "replay",
        title: "No-credentials replay",
        body: (
          <>
            <p>Exercise the agent locally without any TxLINE token:</p>
            <Code>{`
git clone https://github.com/Dami904/Provenn && cd Provenn
npm install
cd mcp

# real captured World Cup odds — no API token needed
npx tsx scripts/run-agent.ts --replay replay-samples/2026-07-11-live-worldcup.jsonl --speed 60

# synthetic single-tick 40pp odds jump — integrity gate refuses to commit
npx tsx scripts/run-agent.ts --replay replay-samples/glitch-demo.jsonl --speed 100
`}</Code>
          </>
        ),
      },
      {
        id: "quickstart",
        title: "Full quickstart (live feed)",
        body: (
          <>
            <p>
              Prereqs: Node ≥ 20, a funded devnet wallet at <code>~/.config/solana/id.json</code>,
              TxLINE devnet credentials in <code>.env</code>.
            </p>
            <Code>{`
npm install

# one-time: subscribe to TxLINE devnet free tier + activate an API token → .env
npx tsx mcp/scripts/txline-setup.ts

# one-time: register the agent on-chain
cd mcp && npx tsx scripts/run-agent.ts --register

# run the agent against the live feed
npx tsx scripts/run-agent.ts

# dashboard: API + UI (visit http://localhost:5173 — add ?demo for canned data)
npx tsx scripts/serve-api.ts
cd ../app && npx vite
`}</Code>
            <p>
              <code>.env</code> keys: <code>TXLINE_ENV=devnet</code>, <code>TXLINE_JWT</code>,{" "}
              <code>TXLINE_API_TOKEN</code> (written by <code>txline-setup.ts</code>).
            </p>
          </>
        ),
      },
      {
        id: "testing",
        title: "Testing",
        body: (
          <div className="doc-table-scroll">
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Layer</th>
                  <th>Covers</th>
                  <th>Command</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>MCP unit tests</td>
                  <td>
                    Signal math, overround normalization, integrity gate, commit-hash vectors, the
                    runner loop with a mock chain
                  </td>
                  <td>
                    <code>npm test</code>
                  </td>
                </tr>
                <tr>
                  <td>Dashboard tests</td>
                  <td>Event-log folding, incl. the integrity-gate watch card</td>
                  <td>
                    <code>npm test --workspace=@provenn/app</code>
                  </td>
                </tr>
                <tr>
                  <td>Program integration</td>
                  <td>
                    In-process Solana (litesvm) — register→commit→reveal, double-commit reject,
                    wrong-nonce, unrevealed settle, stake escrow + slash
                  </td>
                  <td>
                    <code>cd program/tests && npm test</code>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ),
      },
    ],
  },
];

/** Sidebar groups, in page order. */
export function docGroups(): { label: string; pages: DocPage[] }[] {
  const groups: { label: string; pages: DocPage[] }[] = [];
  for (const page of DOC_PAGES) {
    const last = groups[groups.length - 1];
    if (last && last.label === page.group) last.pages.push(page);
    else groups.push({ label: page.group, pages: [page] });
  }
  return groups;
}

export function findDocPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((p) => p.slug === slug);
}

export function docHref(page: DocPage): string {
  return page.slug ? `/docs/${page.slug}` : "/docs";
}
