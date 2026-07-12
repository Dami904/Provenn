# Provenn

> Trading agents whose track records can't be faked — a mandatory-reveal commit ledger with Brier scoring on Solana, fed by TxLINE World Cup data.

Built for the **TxODDS World Cup Hackathon** (Trading Tools & Agents track).

Provenn is an open protocol: anyone can register their own agent on the devnet program and compete on the public leaderboard — see **[REGISTER.md](REGISTER.md)**.

## The problem

Anyone can claim a great trading record; nobody can verify it wasn't fabricated after the fact. Timestamping single calls isn't enough — hidden losses do the lying. Provenn's rule: an agent registers one on-chain identity, **every** committed prediction must be revealed by settlement, and an unrevealed commit automatically scores as a maximum-loss Brier. Silence is penalized, so the complete record — wins and losses — is structurally impossible to hide.

## How it works

1. **Watch** — the agent polls TxLINE live World Cup odds (demargined consensus prices) and runs a deterministic drift detector: same feed in, same signal out. An integrity gate refuses to act on stale or glitchy data.
2. **Commit** — when a signal fires, `sha256(prediction ‖ nonce)` is committed on-chain *before* the outcome is known (program stores slot + timestamp).
3. **Reveal** — after the match, the plaintext prediction + nonce are revealed; the program verifies the hash.
4. **Settle** — the outcome is recorded and the agent's cumulative Brier score (basis points) updates on-chain. Unrevealed commits settle as losses.

The decision logic is fully deterministic — pure math (odds drift vs. implied probability over a window, fixed thresholds), with no LLM in the loop. The same feed always produces the same signal, so every call is independently reproducible.

### Settlement: what's live vs. what's next

Two settlement paths exist on-chain:

- **`settle(match_id, outcome)`** — the **live** path. Gated on a `SETTLE_AUTHORITY` signer that reports the result. This is what the runner uses today, so the current trust assumption is: *the timing and completeness of the record are trustless (commit-reveal + mandatory reveal), but the reported outcome trusts one settling key.*
- **`settle_with_proof(...)`** — **deployed** (in the on-chain IDL) but **not yet wired into the runner or exercised against a live match.** It removes the admin from the result path entirely by verifying the outcome against TxODDS's own on-chain data oracle via CPI (see [`docs/trustless-settlement.md`](docs/trustless-settlement.md)). Wiring it end-to-end needs a completed, TxODDS-anchored fixture and the subscription API token.

We state this split explicitly rather than claim end-to-end trustlessness that isn't wired yet.

## Monorepo layout

| Directory | What it is |
|---|---|
| `mcp/` | TypeScript MCP server + agent runner — TxLINE feed client, deterministic signal detection, feed capture/replay, Solana chain client |
| `program/` | Anchor (Rust) Solana program — agent registry, commit-reveal ledger, Brier scoring (devnet: `Ayfm8HcwaMTXFVxc3zTvXBcLAu57tHc4gVKMgE1wSpr2`) |
| `app/` | Vite + React dashboard — live watch, commit ledger with proof links, leaderboard |

## Quickstart

Prereqs: Node ≥ 20; a funded Solana devnet wallet at `~/.config/solana/id.json`; TxLINE devnet credentials in `.env` (see below).

```bash
npm install

# one-time: subscribe to TxLINE devnet free tier + activate an API token → .env
npx tsx mcp/scripts/txline-setup.ts

# one-time: register the agent on-chain (strategy hash = hash of the detector source)
cd mcp && npx tsx scripts/run-agent.ts --register

# run the agent against the live feed
npx tsx scripts/run-agent.ts

# or replay a recorded capture (how judges can test after the tournament)
npx tsx scripts/run-agent.ts --replay replay-samples/2026-07-11-live-worldcup.jsonl --speed 60

# dashboard: API + UI (visit http://localhost:5173 — add ?demo for canned data)
npx tsx scripts/serve-api.ts
cd ../app && npx vite

# on-chain track record, as anyone can read it
cd ../mcp && npx tsx scripts/agent-status.ts

# tests (deterministic signal math, integrity gate, prediction hashing)
npm test
```

`.env` keys: `TXLINE_ENV=devnet`, `TXLINE_JWT`, `TXLINE_API_TOKEN` (written by `txline-setup.ts`).

## Trust model — stated plainly

Provenn proves **timing and completeness**: every call was fixed before the outcome existed, and no call can be hidden. It does not prove the agent's internal computation was followed — that would require a ZK proof of execution, which is out of scope. The strategy hash registered on-chain commits the agent to its exact decision code; the deterministic detector makes every signal independently reproducible from the same feed data.
