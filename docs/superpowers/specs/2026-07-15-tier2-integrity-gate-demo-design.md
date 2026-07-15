# Tier 2 completion: integrity-gate demo + World/Monaco descope

**Date:** 2026-07-15
**Status:** approved, implementing

## Context

`PLAN.md` §6 lists four Tier 2 (differentiator) items. Two are done (Brier
scoring/leaderboard, open registration docs). The remaining two:

1. "Data integrity gate with a demoable 'refused to fire on glitch' example"
2. "Real trade execution on World/Monaco (small size, devnet-or-mainnet)"

## World/Monaco: descope decision

Researched both platforms (2026-07-15):

- **World.xyz** — no public developer docs, SDK, or program ID found anywhere.
  Everything describes it as order-routing through Phantom with Chainlink
  oracles. No evidence of a third-party integration surface. This matches the
  risk `PLAN.md` §11.3 already flagged ("or is it Phantom-walled?").
- **Monaco Protocol** — technically viable: an actively maintained npm package
  (`@monaco-protocol/client`, v12.0.0), permissionless, and it's the
  infrastructure behind two live sportsbooks that list football markets,
  **BetDEX** and **PureBet** (BetDEX is the one named in `PLAN.md` §5).
- **But**: a live check of both found no confirmed, liquid World Cup 2026
  market on either platform. BetDEX's site is a bare SPA shell with no visible
  market data, and neither platform appears in broader "World Cup 2026
  betting sites" coverage alongside the major sportsbooks/Polymarket. Real
  trade execution depends on a live, liquid counterparty market existing on
  an external platform we don't control — an unresolved dependency this close
  to the Jul 19 deadline.

**Decision:** descope World/Monaco execution. Document the research and
reasoning in `PLAN.md` (this is honest, judge-facing scoping — the plan
already explicitly allows a signals-only fallback, §5 Tier 2 stretch note).
No code changes for this item; it's a documentation update only.

## Integrity-gate demo: what's broken and what to build

`mcp/src/agent/runner.ts:237` logs the event kind `"integrity_skip"` when
`checkFeedIntegrity` rejects a snapshot. The dashboard's event folder,
`app/src/lib/types.ts` `foldEvents` (`isWatchEvent`, lines ~162-170), only
recognizes `"skip"` and `"integrity_gated"` as watch-card-updating kinds —
never `"integrity_skip"`. The one UI branch built to render this
(`app/src/pages/Dashboard.tsx:239`, `` `gated: ${w.reason ?? "bad feed"}` ``)
is consequently unreachable from real runner output today. There is no
recorded example anywhere of the gate actually refusing to fire.

### Changes

1. **Fix `foldEvents`** (`app/src/lib/types.ts`): add `"integrity_skip"` to
   the `isWatchEvent` kind check, and when `e.kind === "integrity_skip"` set
   `w.integrityOk = false` (mirroring the existing `"integrity_gated"`
   handling). `e.reason` already flows through the existing `else if
   (e.reason) w.reason = e.reason` branch, so no separate reason-handling
   change is needed once the kind is recognized.

2. **Synthetic glitch replay fixture**: add
   `mcp/replay-samples/glitch-demo.jsonl` — a small, clearly-synthetic
   capture (few snapshots, one fixture) where one tick jumps implied
   probability by more than the 25pp `MAX_TICK_JUMP` threshold in
   `mcp/src/signal/integrity.ts`. This is *not* raw TxLINE data; it exists
   solely to exercise the glitch heuristic deterministically. It must be
   labeled as such — a header comment/note in the file's accompanying doc
   (README quickstart section), not presented as a real capture.

3. **Docs**:
   - `README.md` quickstart: add a line showing how to replay the glitch
     demo (`--replay mcp/replay-samples/glitch-demo.jsonl`), explicitly
     noting it's synthetic and what it demonstrates.
   - `PLAN.md`: mark the integrity-gate demo item done in §6, and add the
     World/Monaco descope note (with the research summary above) in §9/§11.

### Testing

- Add a focused test for `foldEvents` (new file if none exists for
  `app/src/lib`, e.g. `app/src/lib/types.test.ts`) asserting that an
  `"integrity_skip"` event with a `reason` produces a watch card with
  `integrityOk: false` and that `reason` populated.
- Manually run the agent runner in replay mode against
  `glitch-demo.jsonl`, confirm `integrity_skip` is logged, and confirm the
  dashboard (demo or live-pointed-at-that-log) renders "gated: glitch
  heuristic: …" for that fixture.

## Out of scope

- No changes to `checkFeedIntegrity` itself — the detection logic is correct
  and already unit-tested (`mcp/test/integrity.test.ts`).
- No World/Monaco code of any kind.
- No changes to `FRICTION.md` (separate, already-tracked gap from the earlier
  status check, not part of this task).
