import type { OddsSnapshot } from "../txline/types.js";

/**
 * Pure, deterministic signal math. No I/O, no clocks, no randomness —
 * every function here is unit-testable and mathematically defensible.
 */

export type Outcome = "home" | "draw" | "away";

export interface SignalResult {
  fired: boolean;
  outcome?: Outcome;
  /** Drift in percentage points of normalized implied probability. */
  driftPct?: number;
  /** "steam" = probability rising (money coming in), "drift" = falling. */
  direction?: "steam" | "drift";
  reason: string;
}

/** Implied probability of decimal odds: 1 / odds. */
export function impliedProbability(decimalOdds: number): number {
  if (decimalOdds <= 0) throw new Error(`invalid decimal odds: ${decimalOdds}`);
  return 1 / decimalOdds;
}

/**
 * Remove the bookmaker overround by normalizing implied probabilities to sum
 * to 1 (proportional / basic normalization).
 */
export function normalizeOverround(probs: number[]): number[] {
  const sum = probs.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error("probabilities must sum to a positive value");
  return probs.map((p) => p / sum);
}

const OUTCOMES: Outcome[] = ["home", "draw", "away"];

function normalizedProbs(s: OddsSnapshot): Record<Outcome, number> {
  const [home, draw, away] = normalizeOverround([
    impliedProbability(s.prices.home),
    impliedProbability(s.prices.draw),
    impliedProbability(s.prices.away),
  ]);
  return { home, draw, away };
}

/**
 * Detect a significant odds shift ("steam move") over a time window.
 *
 * Method: take the oldest snapshot inside the window and the newest snapshot,
 * compute overround-normalized implied probabilities for each outcome, and
 * measure the absolute change in percentage points. If any outcome moved by
 * at least `thresholdPct` points, the signal fires on the largest mover.
 *
 * Deterministic: the result is a pure function of (history, windowSeconds,
 * thresholdPct). The window is anchored to the newest snapshot's timestamp,
 * not wall-clock time.
 */
export function detectShift(
  history: OddsSnapshot[],
  windowSeconds: number,
  thresholdPct: number,
): SignalResult {
  if (history.length < 2) {
    return { fired: false, reason: "insufficient history (need >= 2 snapshots)" };
  }

  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
  const newest = sorted[sorted.length - 1];
  const windowStart = newest.timestamp - windowSeconds * 1000;
  const inWindow = sorted.filter((s) => s.timestamp >= windowStart);

  if (inWindow.length < 2) {
    return { fired: false, reason: `insufficient snapshots within ${windowSeconds}s window` };
  }

  const before = normalizedProbs(inWindow[0]);
  const after = normalizedProbs(newest);

  let best: { outcome: Outcome; driftPct: number } | undefined;
  for (const outcome of OUTCOMES) {
    const driftPct = (after[outcome] - before[outcome]) * 100;
    if (!best || Math.abs(driftPct) > Math.abs(best.driftPct)) {
      best = { outcome, driftPct };
    }
  }

  if (!best || Math.abs(best.driftPct) < thresholdPct) {
    return {
      fired: false,
      reason: `max drift ${best ? Math.abs(best.driftPct).toFixed(2) : "0"}pp below threshold ${thresholdPct}pp`,
    };
  }

  const direction = best.driftPct > 0 ? "steam" : "drift";
  return {
    fired: true,
    outcome: best.outcome,
    driftPct: Number(Math.abs(best.driftPct).toFixed(4)),
    direction,
    reason: `${best.outcome} implied probability ${direction === "steam" ? "rose" : "fell"} ${Math.abs(
      best.driftPct,
    ).toFixed(2)}pp within ${windowSeconds}s (threshold ${thresholdPct}pp)`,
  };
}
