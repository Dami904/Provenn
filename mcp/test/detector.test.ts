import { describe, expect, it } from "vitest";
import { detectShift, impliedProbability, normalizeOverround } from "../src/signal/detector.js";
import type { OddsSnapshot } from "../src/txline/types.js";

const T0 = 1_750_000_000_000;

function snap(offsetSeconds: number, home: number, draw: number, away: number): OddsSnapshot {
  return {
    matchId: "m1",
    timestamp: T0 + offsetSeconds * 1000,
    market: "1x2",
    prices: { home, draw, away },
  };
}

describe("impliedProbability", () => {
  it("is 1/odds", () => {
    expect(impliedProbability(2.0)).toBe(0.5);
    expect(impliedProbability(4.0)).toBe(0.25);
  });

  it("rejects non-positive odds", () => {
    expect(() => impliedProbability(0)).toThrow();
    expect(() => impliedProbability(-1.5)).toThrow();
  });
});

describe("normalizeOverround", () => {
  it("normalizes probabilities to sum to 1", () => {
    const normalized = normalizeOverround([0.5, 0.3333333333, 0.25]);
    const sum = normalized.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("preserves relative proportions", () => {
    const [a, b] = normalizeOverround([0.6, 0.6]);
    expect(a).toBeCloseTo(0.5, 10);
    expect(b).toBeCloseTo(0.5, 10);
  });
});

describe("detectShift", () => {
  // home normalized implied prob: ~46.15% -> ~50.4% -> ~56.3% (≈ +10pp total)
  const risingHome = [
    snap(0, 2.0, 3.0, 4.0),
    snap(120, 1.8, 3.2, 4.5),
    snap(240, 1.6, 3.5, 5.0),
  ];

  it("fires steam on home when implied prob rises >5pp within the window", () => {
    const result = detectShift(risingHome, 300, 5);
    expect(result.fired).toBe(true);
    expect(result.outcome).toBe("home");
    expect(result.direction).toBe("steam");
    expect(result.driftPct).toBeGreaterThan(5);
  });

  it("does NOT fire when the drift is below threshold", () => {
    const result = detectShift(risingHome, 300, 15);
    expect(result.fired).toBe(false);
  });

  it("does NOT fire when the movement happened outside the window", () => {
    // Only the newest snapshot falls inside a 60s window; the move is older.
    const result = detectShift(risingHome, 60, 5);
    expect(result.fired).toBe(false);
  });

  it("does NOT fire with fewer than 2 snapshots", () => {
    expect(detectShift([snap(0, 2.0, 3.0, 4.0)], 300, 5).fired).toBe(false);
    expect(detectShift([], 300, 5).fired).toBe(false);
  });

  it("is deterministic for the same inputs", () => {
    const a = detectShift(risingHome, 300, 5);
    const b = detectShift(risingHome, 300, 5);
    expect(a).toEqual(b);
  });
});
