import type { OddsSnapshot } from "../txline/types.js";
import { impliedProbability } from "./detector.js";

export interface IntegrityResult {
  ok: boolean;
  reason?: string;
}

/** Newest snapshot older than this is considered stale. */
const MAX_STALENESS_MS = 120_000;
/** Single-tick implied-probability jump above this is treated as a feed glitch. */
const MAX_TICK_JUMP = 0.25; // 25 percentage points

/**
 * Pure feed sanity check. Deterministic: caller supplies `nowMs`.
 *
 * Rejects:
 *  - empty history
 *  - stale data (newest snapshot older than 120s relative to nowMs)
 *  - non-monotonic timestamps
 *  - any decimal price <= 1.0 (impossible / corrupt)
 *  - a single-tick implied-probability jump > 25 percentage points on any
 *    outcome (glitch heuristic — real markets don't reprice that violently
 *    in one tick without a red card or goal, which we'd rather sit out).
 */
export function checkFeedIntegrity(history: OddsSnapshot[], nowMs: number): IntegrityResult {
  if (history.length === 0) {
    return { ok: false, reason: "empty history" };
  }

  const newest = history[history.length - 1];
  if (nowMs - newest.timestamp > MAX_STALENESS_MS) {
    return { ok: false, reason: `stale feed: newest snapshot is ${Math.round((nowMs - newest.timestamp) / 1000)}s old` };
  }

  for (let i = 1; i < history.length; i++) {
    if (history[i].timestamp < history[i - 1].timestamp) {
      return { ok: false, reason: `non-monotonic timestamps at index ${i}` };
    }
  }

  for (const [i, s] of history.entries()) {
    for (const [k, price] of Object.entries(s.prices)) {
      if (price <= 1.0) {
        return { ok: false, reason: `invalid price ${price} for ${k} at index ${i}` };
      }
    }
  }

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1].prices;
    const cur = history[i].prices;
    for (const k of ["home", "draw", "away"] as const) {
      const jump = Math.abs(impliedProbability(cur[k]) - impliedProbability(prev[k]));
      if (jump > MAX_TICK_JUMP) {
        return {
          ok: false,
          reason: `glitch heuristic: ${k} implied prob jumped ${(jump * 100).toFixed(1)}pp in one tick at index ${i}`,
        };
      }
    }
  }

  return { ok: true };
}
