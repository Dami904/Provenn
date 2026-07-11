import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentRunner, type Chain, type Feed } from "../src/agent/runner.js";
import { commitHash } from "../src/agent/prediction.js";
import type { Fixture, OddsPayload, ScoreEvent } from "../src/txline/types.js";

const T0 = 1_780_000_000_000;
const MATCH = 990_000_001;

function fixture(): Fixture {
  return {
    Ts: T0,
    StartTime: T0 + 3_600_000,
    Competition: "World Cup",
    CompetitionId: 1,
    FixtureGroupId: 1,
    Participant1Id: 1,
    Participant1: "Testonia",
    Participant2Id: 2,
    Participant2: "Fakeland",
    FixtureId: MATCH,
    Participant1IsHome: true,
    GameState: 1,
  };
}

function odds(tsOffsetSec: number, home: number, draw: number, away: number): OddsPayload[] {
  return [
    {
      FixtureId: MATCH,
      MessageId: `m-${tsOffsetSec}`,
      Ts: T0 + tsOffsetSec * 1000,
      Bookmaker: "TXLineStablePriceDemargined",
      BookmakerId: 1,
      SuperOddsType: "1X2_PARTICIPANT_RESULT",
      GameState: null,
      InRunning: false,
      MarketParameters: null,
      MarketPeriod: null,
      PriceNames: ["part1", "draw", "part2"],
      Prices: [home * 1000, draw * 1000, away * 1000],
      Pct: ["NA", "NA", "NA"],
    },
  ];
}

function finalScore(p1: number, p2: number): ScoreEvent {
  return {
    FixtureId: MATCH,
    GameState: "finished",
    StartTime: T0,
    IsTeam: true,
    FixtureGroupId: 1,
    CompetitionId: 1,
    CountryId: 1,
    SportId: 1,
    Participant1IsHome: true,
    Participant1Id: 1,
    Participant2Id: 2,
    Action: "game_finalised",
    Id: 1,
    Ts: T0 + 7_200_000,
    ConnectionId: 1,
    Seq: 99,
    ScoreSoccer: { Participant1: p1, Participant2: p2 },
  };
}

/** Scriptable feed: each tick pops the next odds frame; scores are settable. */
class FakeFeed implements Feed {
  frames: OddsPayload[][] = [];
  scores: ScoreEvent[] = [];
  private current: OddsPayload[] = [];
  private nowMs = T0;

  virtualNowMs(): number {
    return this.nowMs;
  }
  async getFixtures(): Promise<Fixture[]> {
    return [fixture()];
  }
  async getOddsSnapshot(): Promise<OddsPayload[]> {
    if (this.frames.length > 0) {
      this.current = this.frames.shift()!;
      this.nowMs = this.current[0].Ts;
    }
    return this.current;
  }
  async getScores(): Promise<ScoreEvent[]> {
    return this.scores;
  }
}

class FakeChain implements Chain {
  commits: Array<{ matchId: bigint; hash: Uint8Array }> = [];
  reveals: Array<{ matchId: bigint; prediction: { outcome: number; confidence_bps: number }; nonce: Uint8Array }> = [];
  settles: Array<{ matchId: bigint; actualOutcome: number }> = [];

  async commit(matchId: bigint, hash: Uint8Array): Promise<string> {
    this.commits.push({ matchId, hash });
    return `commit-tx-${matchId}`;
  }
  async reveal(matchId: bigint, prediction: { outcome: number; confidence_bps: number }, nonce: Uint8Array): Promise<string> {
    // Enforce the same hash check the program performs.
    const expected = this.commits.find((c) => c.matchId === matchId);
    if (!expected) throw new Error("no commit");
    const recomputed = commitHash(prediction, nonce);
    if (Buffer.from(recomputed).toString("hex") !== Buffer.from(expected.hash).toString("hex")) {
      throw new Error("HashMismatch");
    }
    this.reveals.push({ matchId, prediction, nonce });
    return `reveal-tx-${matchId}`;
  }
  async settle(matchId: bigint, actualOutcome: number): Promise<string> {
    this.settles.push({ matchId, actualOutcome });
    return `settle-tx-${matchId}`;
  }
  async fetchAgent() {
    return {
      authority: null as never,
      name: "fake",
      strategyHash: new Uint8Array(32),
      totalCommits: BigInt(this.commits.length),
      revealedCount: BigInt(this.reveals.length),
      cumulativeBrierBps: 0n,
    };
  }
}

describe("AgentRunner", () => {
  let dir: string;
  let stateFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "runner-test-"));
    stateFile = join(dir, "state.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function makeRunner(feed: Feed, chain: Chain) {
    return new AgentRunner({
      feed,
      chain,
      stateFile,
      windowSeconds: 300,
      thresholdPct: 5,
    });
  }

  it("commits once when a shift fires, then reveals+settles on game_finalised", async () => {
    const feed = new FakeFeed();
    const chain = new FakeChain();
    // Home implied prob rises well past 5pp within the window.
    feed.frames = [odds(0, 3.0, 3.4, 2.6), odds(60, 2.4, 3.5, 3.2), odds(120, 2.0, 3.6, 4.0)];
    const runner = makeRunner(feed, chain);

    await runner.tick(); // 1 snapshot: insufficient history
    await runner.tick(); // 2 snapshots: may or may not fire
    await runner.tick(); // strong move: must have fired by now
    expect(chain.commits.length).toBe(1);
    expect(chain.commits[0].matchId).toBe(BigInt(MATCH));

    const persisted = JSON.parse(readFileSync(stateFile, "utf8"));
    const rec = persisted.matches[String(MATCH)];
    expect(rec.phase).toBe("committed");
    expect(rec.prediction.outcome).toBe(0); // home steam
    expect(rec.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.commitTx).toBe(`commit-tx-${MATCH}`);

    // No double commit on further ticks.
    await runner.tick();
    expect(chain.commits.length).toBe(1);

    // Final whistle: home wins 2-1 -> reveal + settle(0).
    feed.scores = [finalScore(2, 1)];
    await runner.tick();
    expect(chain.reveals.length).toBe(1); // hash verified inside FakeChain.reveal
    expect(chain.settles).toEqual([{ matchId: BigInt(MATCH), actualOutcome: 0 }]);
    const settled = JSON.parse(readFileSync(stateFile, "utf8")).matches[String(MATCH)];
    expect(settled.phase).toBe("settled");
    expect(settled.actualOutcome).toBe(0);
  });

  it("resumes a pending reveal from the state file after a restart", async () => {
    const feed = new FakeFeed();
    const chain = new FakeChain();
    feed.frames = [odds(0, 3.0, 3.4, 2.6), odds(60, 2.0, 3.6, 4.0)];
    const runner1 = makeRunner(feed, chain);
    await runner1.tick();
    await runner1.tick();
    expect(chain.commits.length).toBe(1);

    // "Restart": a new runner instance sharing only the state file and chain.
    const feed2 = new FakeFeed();
    feed2.scores = [finalScore(0, 2)]; // away win
    const runner2 = makeRunner(feed2, chain);
    await runner2.tick();
    expect(chain.reveals.length).toBe(1);
    expect(chain.settles[0].actualOutcome).toBe(2);
    expect(JSON.parse(readFileSync(stateFile, "utf8")).matches[String(MATCH)].phase).toBe("settled");
  });

  it("does not fire on quiet odds and skips integrity-failing feeds", async () => {
    const feed = new FakeFeed();
    const chain = new FakeChain();
    // Quiet market, then a corrupt price (<= 1.0) which must be integrity-gated.
    feed.frames = [odds(0, 2.0, 3.4, 3.8), odds(60, 2.02, 3.42, 3.76), odds(120, 0.5, 3.4, 3.8)];
    const runner = makeRunner(feed, chain);
    await runner.tick();
    await runner.tick();
    await runner.tick();
    expect(chain.commits.length).toBe(0);
  });
});
