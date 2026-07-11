import { readFileSync } from "node:fs";
import type { CaptureLine } from "./recorder.js";
import { toOddsSnapshot, type Fixture, type OddsPayload, type OddsSnapshot, type ScoreEvent } from "./txline/types.js";

/**
 * ReplayFeed — plays back a JSONL capture file with the same method surface
 * as TxLineClient, so the detector and agent can run deterministically
 * against recorded data (demo insurance + reproducible signal evaluation).
 *
 * A virtual clock starts at the first capture's timestamp when the feed is
 * constructed and advances at `speed`x real time. Each getter returns only
 * data captured at or before the current virtual time.
 *
 * Capture payload convention (kept simple): each line's payload is
 * { kind: "fixtures" | "odds" | "scores", matchId?, data }.
 */

interface ReplayEntry {
  atMs: number;
  kind: string;
  matchId?: string;
  data: unknown;
}

export class ReplayFeed {
  private readonly entries: ReplayEntry[];
  private readonly speed: number;
  private readonly startVirtualMs: number;
  private readonly startRealMs: number;

  constructor(captureFile: string, options: { speed: number } = { speed: 1 }) {
    this.speed = options.speed;
    const lines = readFileSync(captureFile, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as CaptureLine);

    this.entries = lines.map((line) => {
      const p = line.payload as { kind?: string; matchId?: string; data?: unknown };
      return {
        atMs: Date.parse(line.capturedAt),
        kind: p.kind ?? "unknown",
        matchId: p.matchId,
        data: p.data ?? line.payload,
      };
    });
    this.entries.sort((a, b) => a.atMs - b.atMs);

    this.startVirtualMs = this.entries.length > 0 ? this.entries[0].atMs : Date.now();
    this.startRealMs = Date.now();
  }

  /** Current position of the virtual clock, in capture-time milliseconds. */
  virtualNowMs(): number {
    return this.startVirtualMs + (Date.now() - this.startRealMs) * this.speed;
  }

  private visible(kind: string, matchId?: string): ReplayEntry[] {
    const now = this.virtualNowMs();
    return this.entries.filter(
      (e) => e.kind === kind && e.atMs <= now && (matchId === undefined || e.matchId === matchId),
    );
  }

  private latest<T>(kind: string, matchId?: string): T | undefined {
    const v = this.visible(kind, matchId);
    return v.length > 0 ? (v[v.length - 1].data as T) : undefined;
  }

  // --- Same surface as TxLineClient ---

  async getFixtures(): Promise<Fixture[]> {
    return this.latest<Fixture[]>("fixtures") ?? [];
  }

  async getOddsSnapshot(matchId: string): Promise<OddsPayload[]> {
    const snap = this.latest<OddsPayload[]>("odds", matchId);
    if (!snap) throw new Error(`replay: no odds captured yet for match ${matchId} at virtual time`);
    return snap;
  }

  async getScores(matchId: string): Promise<ScoreEvent[]> {
    return this.visible("scores", matchId).map((e) => e.data as ScoreEvent);
  }

  /**
   * Normalized full-time 1X2 history for a match visible at the current
   * virtual time (handy for detectShift). Raw captures hold OddsPayload[];
   * entries without a full-time 1X2 record are skipped.
   */
  async getOddsHistory(matchId: string): Promise<OddsSnapshot[]> {
    return this.visible("odds", matchId)
      .map((e) => toOddsSnapshot(e.data as OddsPayload[]))
      .filter((s): s is OddsSnapshot => s !== undefined);
  }
}
