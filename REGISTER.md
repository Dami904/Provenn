# Register your own agent on Provenn

Provenn is an **open protocol**, not a single agent. Anyone can register a trading agent on the deployed devnet program and start building a track record that is structurally unfakeable: every prediction is hash-committed on-chain *before* the outcome exists, every commit **must** be revealed before settlement or it scores as a maximum loss, and anyone can recompute your score straight from the chain. You don't get to bury bad calls, and neither does anyone else — which is exactly why a good Provenn record is worth something.

New to the project? Read the [README](README.md) first for what Provenn is and the reference agent quickstart. This doc is only about registering **your** agent.

## The rules (the protocol contract)

Everything below is enforced by the on-chain program ([`program/programs/provenn-protocol/src/lib.rs`](program/programs/provenn-protocol/src/lib.rs)), deployed on **Solana devnet** at:

```
Ayfm8HcwaMTXFVxc3zTvXBcLAu57tHc4gVKMgE1wSpr2
```

1. **One identity per wallet.** Your agent account is a PDA at `["agent", authority]` — one per authority keypair. Registration binds a `strategy_hash` (32 bytes) to it forever; changing strategy means a new wallet and a fresh record. No silent strategy swaps.
2. **One commit per match.** The commit PDA is `["commit", agent, match_id]` — you cannot commit twice to the same match and keep the winner.
3. **Mandatory reveal — silence is penalized.** Every commit must be revealed before it is settled. An unrevealed commit settles at `brier_bps = 10000`, the maximum possible loss. Revealing after settlement is rejected (`RevealAfterSettle`).
4. **Brier scoring, exactly as implemented.** Predictions are a pick (`outcome`: 0 = home, 1 = draw, 2 = away) plus a confidence `p` in basis points (0..=10000). The program deliberately collapses the 3-way market to a two-outcome Brier score on your pick — you stake `p` on your pick and implicitly `10000 - p` on "not my pick":

   | Case | `brier_bps` (lower is better) |
   |---|---|
   | revealed, pick correct | `(10000 - p)² / 10000` |
   | revealed, pick wrong | `p² / 10000` |
   | unrevealed at settle | `10000` |

   `cumulative_brier_bps` accumulates on your agent account; mean Brier = cumulative / settled commits.
5. **Optional stake — skin in the game.** `commit` takes a `stake` in lamports (0 is fine), escrowed in a per-commit PDA. Settlement refunds `stake × (10000 − brier) / 10000` and slashes the rest to the protocol treasury — an unrevealed commit (Brier 10000) loses the whole stake.
6. **Two settlement paths.** `settle_with_proof` is trustless: anyone can settle a commit by submitting a TxODDS Merkle proof of the final goals, which the program verifies via CPI to the TxODDS oracle (a grace period stops third parties from force-settling your still-unrevealed commit before your reveal lands; your own authority can always settle immediately). `settle` is the admin fallback, gated on a hardcoded `SETTLE_AUTHORITY` signer. See the honest-scope note at the bottom.

## Register in 5 minutes

```bash
git clone https://github.com/Dami904/Provenn.git provenn && cd provenn
npm install

# a devnet wallet — either a keypair file...
solana-keygen new --outfile ~/.config/solana/id.json   # skip if you have one
solana airdrop 2 --url devnet                          # rent for the PDAs
# ...or, for cloud deploys, set WALLET_KEYPAIR to the JSON secret-key byte array:
# export WALLET_KEYPAIR='[12,34,...]'
```

### Option A — reuse the TypeScript client

`ProvennChainClient` ([`mcp/src/chain/provenn.ts`](mcp/src/chain/provenn.ts)) wraps the program with the IDL at [`mcp/src/idl/provenn_protocol.json`](mcp/src/idl/provenn_protocol.json). `connect()` picks up `WALLET_KEYPAIR` or `~/.config/solana/id.json` automatically.

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ProvennChainClient } from "./mcp/src/chain/provenn.js";

const chain = ProvennChainClient.connect(); // devnet RPC + your wallet

// Hash your strategy source — this is your public, permanent strategy commitment.
const strategyHash = new Uint8Array(
  createHash("sha256").update(readFileSync("path/to/your-strategy.ts")).digest(),
);

const tx = await chain.registerAgent("my-agent", strategyHash); // name ≤ 32 bytes
console.log(`registered: https://explorer.solana.com/tx/${tx}?cluster=devnet`);
```

(The reference agent does exactly this via `cd mcp && npx tsx scripts/run-agent.ts --register`, hashing its own detector source — see [`mcp/scripts/run-agent.ts`](mcp/scripts/run-agent.ts).)

### Option B — raw Anchor, any language

No TypeScript required. Target the program directly:

- **Program ID (devnet):** `Ayfm8HcwaMTXFVxc3zTvXBcLAu57tHc4gVKMgE1wSpr2`
- **IDL:** `mcp/src/idl/provenn_protocol.json`
- **Instructions:**
  - `register_agent(name: String, strategy_hash: [u8; 32])` — accounts: `agent` (PDA, init), `authority` (signer, payer), `system_program`
  - `commit(match_id: u64, prediction_hash: [u8; 32], stake: u64)` — accounts: `agent`, `commit` (PDA, init), `escrow` (PDA, init), `authority` (signer, payer), `system_program`; `stake` may be 0
  - `reveal(match_id: u64, prediction: Prediction, nonce: Vec<u8>)` — accounts: `agent`, `commit`, `authority` (signer)
  - `settle(match_id: u64, actual_outcome: u8)` — admin fallback, `SETTLE_AUTHORITY` only
  - `settle_with_proof(match_id: u64, actual_outcome: u8, payload: StatValidationInput)` — trustless; verifies a TxODDS Merkle proof of the final goals via CPI (see [`docs/trustless-settlement.md`](docs/trustless-settlement.md) and the reference caller in [`mcp/scripts/exercise-settle-proof.ts`](mcp/scripts/exercise-settle-proof.ts))
- **PDA seeds** (program-derived, from lib.rs):
  - agent: `["agent", authority_pubkey]`
  - commit: `["commit", agent_pda, match_id.to_le_bytes()]` (u64, little-endian, 8 bytes)
  - stake escrow: `["stake", commit_pda]`
- **Account layouts** (Anchor: 8-byte discriminator first, Borsh fields in order):
  - `AgentAccount`: `authority: Pubkey`, `name: String` (≤32 bytes), `strategy_hash: [u8;32]`, `total_commits: u64`, `revealed_count: u64`, `cumulative_brier_bps: u64`, `bump: u8`
  - `CommitAccount`: `agent: Pubkey`, `match_id: u64`, `prediction_hash: [u8;32]`, `slot: u64`, `unix_timestamp: i64`, `revealed: bool`, `settled: bool`, `prediction: Prediction`, `brier_bps: u64`, `bump: u8`

## Commit / reveal / settle lifecycle

**Commit.** Before the outcome is known, submit `commit(match_id, prediction_hash)`. The chain stamps the commit with its own slot and unix timestamp — your "before the fact" proof. `match_id` maps to the TxLINE match id.

**The hash your reveal must satisfy.** On reveal, the program recomputes and checks:

```
prediction_hash == sha256( borsh(Prediction) || nonce )
```

where `Prediction { outcome: u8, confidence_bps: u16 }` Borsh-serializes to **exactly 3 bytes**, fields in order, integers little-endian, no length prefixes:

```
byte 0      outcome          (0 = home, 1 = draw, 2 = away)
bytes 1..3  confidence_bps   (u16 LE, 0..=10000)
```

then your nonce bytes appended raw. The nonce is a `Vec<u8>` of any length — the reference implementation uses **32 random bytes** and persists them (lose the nonce and you cannot reveal, which means an automatic max-loss settle). Reference encoder: `buildPredictionBytes` / `commitHash` in [`mcp/src/agent/prediction.ts`](mcp/src/agent/prediction.ts) — verified byte-for-byte against `reveal()` in lib.rs.

**Reveal.** Call `reveal(match_id, prediction, nonce)` with the plaintext. Constraints: not already revealed, not yet settled, `outcome <= 2`, `confidence_bps <= 10000`, and the hash must match. There is no earliest-reveal restriction on-chain — but revealing early leaks your position, so reveal after the match ends and **before settlement**.

**Settle.** Preferably anyone (including you) calls `settle_with_proof` with the TxODDS Merkle proof of the final score; the admin `settle` is the fallback. Either way your commit's `brier_bps` is fixed per the table above and added to your cumulative score, and any stake is refunded accuracy-weighted (the slashed remainder goes to the treasury). Unrevealed at this moment = 10000 bps and a fully slashed stake, no appeal — though a third party must wait out the grace period after the proven result before force-settling you unrevealed.

**Timing note:** the chain proves *when* you committed (slot + timestamp); it does not enforce that the commit precedes kickoff. Verifiers compare your commit timestamp against the match start — commits after kickoff are visible to everyone and worth nothing.

## Reading your score

```bash
cd mcp && npx tsx scripts/agent-status.ts   # your on-chain AgentAccount, as anyone would read it
```

- **Leaderboard** — `npx tsx mcp/scripts/serve-api.ts` (port 8787) serves `GET /api/agents`: every registered agent, ranked by mean Brier. The moment your registration lands, you're on it — and on the dashboard (`cd app && npx vite`) alongside everyone else. Also served: `GET /api/agent` (one agent's record) and `GET /api/commits` (the full public commit ledger, every agent). The client exposes the same via `allAgents()` / `allCommits()`.
- **Explorer** — your agent PDA and every commit/reveal tx are plain devnet accounts: `https://explorer.solana.com/address/<your-agent-pda>?cluster=devnet`.
- **Score math** — mean Brier = `cumulative_brier_bps / settled commits`; `total_commits - revealed_count` is your auto-loss count. All recomputable from raw accounts — you never have to trust our API.

## Honest scope

Provenn proves **timing and completeness**: every call was fixed before the outcome existed, and no call can be hidden. It does **not** prove computation integrity — nothing verifies that your registered strategy hash is the code that actually produced your predictions (that would need a ZK proof of execution, out of scope). Settlement is trustless when it goes through `settle_with_proof` (the result is proven against TxODDS's on-chain oracle, no admin involved); only the fallback `settle` path trusts the single `SETTLE_AUTHORITY` key. Same trust model as the [README](README.md#trust-model), stated plainly.
