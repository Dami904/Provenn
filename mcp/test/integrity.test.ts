import { describe, expect, it } from "vitest";
import { checkFeedIntegrity } from "../src/signal/integrity.js";
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

describe("checkFeedIntegrity", () => {
  it("passes a clean, fresh, monotonic history", () => {
    const history = [snap(0, 2.0, 3.0, 4.0), snap(30, 2.1, 3.0, 3.9), snap(60, 2.05, 3.1, 3.95)];
    const now = T0 + 90_000; // 30s after newest
    expect(checkFeedIntegrity(history, now)).toEqual({ ok: true });
  });

  it("rejects empty history", () => {
    const result = checkFeedIntegrity([], T0);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/empty/i);
  });

  it("rejects stale data (newest older than 120s)", () => {
    const history = [snap(0, 2.0, 3.0, 4.0)];
    const now = T0 + 121_000;
    const result = checkFeedIntegrity(history, now);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/stale/i);
  });

  it("rejects non-monotonic timestamps", () => {
    const history = [snap(60, 2.0, 3.0, 4.0), snap(0, 2.0, 3.0, 4.0)];
    const result = checkFeedIntegrity(history, T0 + 90_000);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/monotonic/i);
  });

  it("rejects any price <= 1.0", () => {
    const history = [snap(0, 2.0, 3.0, 4.0), snap(30, 1.0, 3.0, 4.0)];
    const result = checkFeedIntegrity(history, T0 + 60_000);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/price/i);
  });

  it("rejects a single-tick implied-probability glitch (>25pp jump)", () => {
    // home: 2.0 (50%) -> 1.25 (80%) in one tick = 30pp jump
    const history = [snap(0, 2.0, 3.0, 4.0), snap(10, 1.25, 3.0, 4.0)];
    const result = checkFeedIntegrity(history, T0 + 40_000);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/glitch/i);
  });
});
