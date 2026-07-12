# Trustless settlement (`settle_with_proof`)

## The problem it solves

Provenn's original `settle(match_id, actual_outcome)` is gated on a hardcoded
`SETTLE_AUTHORITY` admin signer that simply *asserts* the result. That admin is
the one trusted party in the system — it could score agents against a false
outcome. `settle_with_proof` removes it: the match result is proven against
TxODDS's own on-chain data anchoring, so settlement needs no trusted operator.

## How it works

TxODDS canonicalizes its feed into Merkle trees and publishes the daily roots in
PDAs on its Solana devnet program `txoracle`
(`6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`). Its `validate_stat_v2`
instruction returns `true` iff a supplied record + Merkle proof hashes up to the
anchored root **and** a caller-supplied predicate "strategy" over the proven
stats holds.

`settle_with_proof` composes that primitive:

1. **Client** (`ProvennChainClient.settleWithProof`) fetches the proof from
   `GET /api/scores/stat-validation?fixtureId=&seq=&statKeys=1,2` — the full-time
   home-goals and away-goals stats plus their Merkle proofs — and maps it into
   the program's `StatValidationInput`.
2. **Program** binds the proof to the commit's match (`fixture_id == match_id`)
   and checks the two stats are exactly the pinned goal stats, in order
   (index 0 = home, 1 = away).
3. **Program** builds — itself, not the caller — the predicate that is true iff
   the asserted `actual_outcome` happened, over `home_goals − away_goals`:
   `> 0` home win, `< 0` away win, `== 0` draw.
4. **Program** CPIs `validate_stat_v2` on `txoracle`, passing the daily-root PDA
   read-only. TxODDS recomputes the Merkle root from the proof, compares it to
   its anchored root, and evaluates the predicate.
5. **Program** reads the returned bool via `sol_get_return_data`, requires
   `true`, then runs the *same* Brier scoring as `settle`.

Because the strategy is built inside Provenn and the goal stats are proven
against TxODDS's root, **neither the caller nor any admin can assert a false
result**: a wrong `actual_outcome` makes the predicate false and the instruction
aborts (`OutcomeNotProven`). No `settle_authority` account exists on this path —
anyone can trigger settlement once TxODDS has anchored the final score.

## Why not re-implement the Merkle check in Provenn?

TxODDS's leaf encoding and node-hashing live inside their closed-source program;
the public `tx-on-chain` repo ships only the IDL, TS types, and examples. Rather
than guess their hash scheme (and risk a verifier that is silently wrong), we
treat `validate_stat_v2` as the trust anchor and CPI into it. The only bytes we
mirror are the published IDL types (see `src/txoracle.rs`), guarded by a Borsh
round-trip test and the pinned `validate_stat_v2` discriminator.

## Stat keys (resolved)

`HOME_GOALS_STAT_KEY = 1` and `AWAY_GOALS_STAT_KEY = 2` are grounded in the
documented TxODDS soccer taxonomy: base keys 1–8 are
Goals/Yellow/Red/Corners for Participant1/Participant2, plus a period multiplier
(0 = match total). So key `1` = Participant1 full-time goals, key `2` =
Participant2 full-time goals. This is exactly Provenn's own 1X2 convention
(outcome 0 = Participant1 = "home", outcome 2 = Participant2 = "away"), the same
`part1`/`part2` labelling the odds detector uses — so the proof scores the
agent against precisely the sides it predicted over, no matter which team is
nominally home. The `period` field is intentionally left unconstrained: the key
already encodes the period, so pinning it fully identifies the stat.

## Open items before production use

- **End-to-end devnet verification** requires a finished World Cup fixture whose
  final score TxODDS has anchored, plus the values confirmed against a live
  `/api/scores/stat-validation` response (needs the subscription's
  `X-Api-Token`). Unit tests cover the outcome→predicate mapping and Borsh
  serialization; the CPI itself is only exercised against the live oracle.
- **Redeploy**: `settle_with_proof` is a new instruction, so the program must be
  rebuilt (`anchor build` regenerates the IDL that clients load) and redeployed
  before it is callable. Until then the admin `settle` path stays authoritative.
  Deploy is left to a reviewed step — do not deploy from this branch unattended.
- **Compute budget**: the CPI validates a Merkle path; add a
  `ComputeBudgetProgram.setComputeUnitLimit` pre-instruction if it exceeds the
  200k default (the TxODDS examples do this).

## Files

- `program/programs/provenn-protocol/src/txoracle.rs` — Borsh mirrors of the
  txoracle IDL types + the `outcome_strategy` builder + unit tests.
- `program/programs/provenn-protocol/src/lib.rs` — `settle_with_proof`
  instruction, `SettleWithProof` accounts, shared `apply_settlement` helper.
- `mcp/src/chain/provenn.ts` — `settleWithProof` client method + proof mapping.
- `mcp/src/txline/client.ts` — `getScoreStatValidation` proof fetch.
