import { createHash } from "node:crypto";
import type { Outcome } from "../signal/detector.js";
import type { ScoreEvent } from "../txline/types.js";

/**
 * Pure prediction encoding + scoring helpers.
 *
 * CRITICAL: buildPredictionBytes/commitHash must byte-for-byte mirror the
 * on-chain program (program/programs/provenn-protocol/src/lib.rs):
 *
 *   reveal() recomputes  sha256(borsh(Prediction) || nonce)
 *   where  Prediction { outcome: u8, confidence_bps: u16 }
 *
 * Borsh serializes struct fields in declaration order with little-endian
 * integers and no length prefixes, so borsh(Prediction) is exactly 3 bytes:
 * [outcome, confidence_lo, confidence_hi].
 */

export interface Prediction {
  /** 0 = home win, 1 = draw, 2 = away win (lib.rs encoding). */
  outcome: number;
  /** Confidence in the pick, basis points 0..=10000. */
  confidence_bps: number;
}

/** Borsh-serialize a Prediction exactly as anchor/borsh does on-chain. */
export function buildPredictionBytes(p: Prediction): Uint8Array {
  if (!Number.isInteger(p.outcome) || p.outcome < 0 || p.outcome > 2) {
    throw new Error(`invalid outcome ${p.outcome}: must be 0, 1 or 2`);
  }
  if (!Number.isInteger(p.confidence_bps) || p.confidence_bps < 0 || p.confidence_bps > 10_000) {
    throw new Error(`invalid confidence_bps ${p.confidence_bps}: must be 0..=10000`);
  }
  const buf = Buffer.alloc(3);
  buf.writeUInt8(p.outcome, 0);
  buf.writeUInt16LE(p.confidence_bps, 1);
  return new Uint8Array(buf);
}

/** The commit hash the program stores and later verifies: sha256(bytes || nonce). */
export function commitHash(p: Prediction, nonce: Uint8Array): Uint8Array {
  const h = createHash("sha256");
  h.update(buildPredictionBytes(p));
  h.update(nonce);
  return new Uint8Array(h.digest());
}

/** Detector outcome label -> lib.rs u8 encoding. */
export function outcomeIndex(outcome: Outcome): 0 | 1 | 2 {
  switch (outcome) {
    case "home":
      return 0;
    case "draw":
      return 1;
    case "away":
      return 2;
  }
}

/**
 * Derive the settled 1X2 outcome from a fixture's score events.
 *
 * Settlement record per docs/txline-api-notes.md §2: `Action === "game_finalised"`
 * (statusId=100). The final soccer score lives in ScoreSoccer as
 * Participant1/Participant2 goals; Participant1IsHome maps participants to
 * the home/away slots. Returns undefined until a final score is available.
 */
export function outcomeFromScore(scores: ScoreEvent[]): 0 | 1 | 2 | undefined {
  const finals = scores.filter((s) => s.Action === "game_finalised");
  if (finals.length === 0) return undefined;
  const final = finals[finals.length - 1];
  const score = final.ScoreSoccer;
  if (!score) return undefined;
  const { Participant1: p1, Participant2: p2 } = score;
  if (p1 === p2) return 1;
  const p1Won = p1 > p2;
  const homeWon = final.Participant1IsHome ? p1Won : !p1Won;
  return homeWon ? 0 : 2;
}

/**
 * Map detected drift (percentage points of normalized implied probability)
 * to a confidence in basis points:
 *
 *   confidence_bps = clamp(5000 + driftPct * 300, 5000, 9000)
 *
 * Rationale: the signal only fires at or above the threshold (default 5pp),
 * so a bare-threshold move maps to 6500 bps — meaningfully above a coin
 * flip but far from certainty. Each extra percentage point of steam adds
 * 300 bps. The floor of 5000 means we never claim less than even odds on
 * our own pick, and the 9000 cap acknowledges that no odds move makes a
 * football match >90% certain — it also caps the Brier downside of a
 * maximally confident wrong call. Deterministic and integer-valued (u16).
 */
export function confidenceFromDrift(driftPct: number): number {
  return Math.round(Math.min(9000, Math.max(5000, 5000 + driftPct * 300)));
}
