import { describe, expect, it } from "vitest";
import {
  buildPredictionBytes,
  commitHash,
  confidenceFromDrift,
  outcomeFromScore,
  outcomeIndex,
} from "../src/agent/prediction.js";
import type { ScoreEvent } from "../src/txline/types.js";

describe("buildPredictionBytes", () => {
  it("mirrors the Rust Borsh layout: outcome u8 then confidence_bps u16 LE", () => {
    // Rust: Prediction { outcome: u8, confidence_bps: u16 } — Borsh writes
    // fields in declaration order, integers little-endian, no length prefix.
    const bytes = buildPredictionBytes({ outcome: 2, confidence_bps: 6500 });
    expect(Buffer.from(bytes).toString("hex")).toBe("026419"); // 0x1964 LE = 64 19
    expect(bytes.length).toBe(3);
  });

  it("encodes outcome 0 / confidence 5000", () => {
    const bytes = buildPredictionBytes({ outcome: 0, confidence_bps: 5000 });
    expect(Buffer.from(bytes).toString("hex")).toBe("008813");
  });

  it("rejects out-of-range values", () => {
    expect(() => buildPredictionBytes({ outcome: 3, confidence_bps: 5000 })).toThrow();
    expect(() => buildPredictionBytes({ outcome: 0, confidence_bps: 10001 })).toThrow();
    expect(() => buildPredictionBytes({ outcome: -1, confidence_bps: 5000 })).toThrow();
  });
});

describe("commitHash", () => {
  it("matches the known vector sha256(borsh(Prediction) || nonce)", () => {
    // Verified independently: sha256(0x026419 || 0x0102...20)
    const nonce = Buffer.from(
      "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
      "hex",
    );
    const hash = commitHash({ outcome: 2, confidence_bps: 6500 }, nonce);
    expect(Buffer.from(hash).toString("hex")).toBe(
      "de19f72b94a2d7d20a7bcc39745e1fac41b7c22d301b4f7066498c957fb0a453",
    );
  });

  it("matches the zero-nonce vector", () => {
    const hash = commitHash({ outcome: 0, confidence_bps: 5000 }, Buffer.alloc(32));
    expect(Buffer.from(hash).toString("hex")).toBe(
      "44ea509a20e2109f5742b9ba251a3a966b6299d4ef06ce968e2bba5e44d48148",
    );
  });

  it("is deterministic and nonce-sensitive", () => {
    const p = { outcome: 1, confidence_bps: 7000 };
    const n1 = Buffer.alloc(32, 7);
    const n2 = Buffer.alloc(32, 8);
    expect(Buffer.from(commitHash(p, n1))).toEqual(Buffer.from(commitHash(p, n1)));
    expect(Buffer.from(commitHash(p, n1))).not.toEqual(Buffer.from(commitHash(p, n2)));
  });
});

describe("outcomeIndex", () => {
  it("maps detector outcomes to lib.rs encoding (0 home, 1 draw, 2 away)", () => {
    expect(outcomeIndex("home")).toBe(0);
    expect(outcomeIndex("draw")).toBe(1);
    expect(outcomeIndex("away")).toBe(2);
  });
});

function finalScore(p1: number, p2: number, p1IsHome: boolean): ScoreEvent {
  return {
    FixtureId: 1,
    GameState: "finished",
    StartTime: 0,
    IsTeam: true,
    FixtureGroupId: 0,
    CompetitionId: 0,
    CountryId: 0,
    SportId: 1,
    Participant1IsHome: p1IsHome,
    Participant1Id: 10,
    Participant2Id: 20,
    Action: "game_finalised",
    Id: 1,
    Ts: 0,
    ConnectionId: 0,
    Seq: 5,
    // Real TxLINE shape: goals live in the flat Stats map, key "1" = P1 goals,
    // "2" = P2 goals (the same soccer stat keys settle_with_proof pins).
    Stats: { "1": p1, "2": p2 },
  };
}

describe("outcomeFromScore", () => {
  // Outcome is P1/P2-relative (outcome 0 = P1 wins, 2 = P2 wins), matching the
  // odds detector's part1/part2 indexing — independent of Participant1IsHome.
  it("returns 0 when Participant1 wins", () => {
    expect(outcomeFromScore([finalScore(2, 1, true)])).toBe(0);
  });

  it("returns 2 when Participant2 wins", () => {
    expect(outcomeFromScore([finalScore(0, 3, true)])).toBe(2);
  });

  it("returns 1 on a draw", () => {
    expect(outcomeFromScore([finalScore(1, 1, true)])).toBe(1);
  });

  it("is P1/P2-relative, not flipped by Participant1IsHome", () => {
    // P1 outscores P2 -> outcome 0 regardless of which side is nominally home.
    expect(outcomeFromScore([finalScore(2, 0, false)])).toBe(0);
    expect(outcomeFromScore([finalScore(0, 2, false)])).toBe(2);
  });

  it("treats a missing goal key as 0 (finished 1-0)", () => {
    const s = finalScore(1, 0, true);
    s.Stats = { "1": 1 }; // P2 has no goal key
    expect(outcomeFromScore([s])).toBe(0);
  });

  it("returns undefined when there is no game_finalised event", () => {
    const live = finalScore(1, 0, true);
    live.Action = "goal";
    expect(outcomeFromScore([live])).toBeUndefined();
  });

  it("returns undefined when the final event carries no score at all", () => {
    const s = finalScore(1, 0, true);
    delete s.Stats;
    expect(outcomeFromScore([s])).toBeUndefined();
  });

  it("uses the last game_finalised event in the list", () => {
    expect(outcomeFromScore([finalScore(0, 0, true), finalScore(2, 1, true)])).toBe(0);
  });
});

describe("confidenceFromDrift", () => {
  it("maps drift linearly: 5000 + drift*300, clamped to [5000, 9000]", () => {
    expect(confidenceFromDrift(0)).toBe(5000);
    expect(confidenceFromDrift(5)).toBe(6500);
    expect(confidenceFromDrift(10)).toBe(8000);
    expect(confidenceFromDrift(100)).toBe(9000); // clamp high
    expect(confidenceFromDrift(-3)).toBe(5000); // clamp low
  });

  it("returns an integer (bps must be a whole number for u16)", () => {
    expect(Number.isInteger(confidenceFromDrift(5.5555))).toBe(true);
  });
});
