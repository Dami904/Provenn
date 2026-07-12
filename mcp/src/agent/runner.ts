import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ProvennChainClient } from "../chain/provenn.js";
import { detectShift } from "../signal/detector.js";
import { checkFeedIntegrity } from "../signal/integrity.js";
import { appendCapture } from "../recorder.js";
import { toOddsSnapshot, type Fixture, type OddsPayload, type OddsSnapshot, type ScoreEvent } from "../txline/types.js";
import { commitHash, confidenceFromDrift, outcomeFromScore, outcomeIndex, type Prediction } from "./prediction.js";

/** Best-effort human-readable message from anything thrown (anchor throws objects). */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Feed surface shared by TxLineClient and ReplayFeed. */
export interface Feed {
  getFixtures(startEpochDay?: number): Promise<Fixture[]>;
  getOddsSnapshot(matchId: string): Promise<OddsPayload[]>;
  getScores(matchId: string): Promise<ScoreEvent[]>;
  /** ReplayFeed's virtual clock; live feeds omit this and we use Date.now(). */
  virtualNowMs?(): number;
}

/** Minimal chain surface the runner needs (ProvennChainClient satisfies it). */
export type Chain = Pick<ProvennChainClient, "commit" | "reveal" | "settle" | "fetchAgent">;

export type MatchPhase = "committed" | "revealed" | "settled";

export interface MatchRecord {
  matchId: string;
  prediction: Prediction;
  /** Hex-encoded commit nonce — persisting this is what makes reveal survive a restart. */
  nonce: string;
  commitTx: string;
  revealTx?: string;
  settleTx?: string;
  actualOutcome?: number;
  phase: MatchPhase;
  committedAt: string;
}

interface RunnerState {
  matches: Record<string, MatchRecord>;
}

export interface AgentRunnerOptions {
  feed: Feed;
  chain: Chain;
  /** Poll interval in ms (default 30000). */
  pollMs?: number;
  /** detectShift window in seconds (default 300). */
  windowSeconds?: number;
  /** detectShift threshold in percentage points (default 5). */
  thresholdPct?: number;
  /** JSON file for crash-safe commit/reveal state. */
  stateFile: string;
  /** JSONL decision log (default mcp/agent-log.jsonl next to cwd caller). */
  logFile?: string;
  /** Directory for raw odds captures; omit to disable capture recording. */
  capturesDir?: string;
  /** Competition filter (default "World Cup"). */
  competition?: string;
  /** Lamports to stake on each commit (default 0 = no stake). Refunded
   * accuracy-weighted at settlement; slashed for wrong/hidden calls. */
  stakeLamports?: number;
}

/**
 * Autonomous commit/reveal agent loop.
 *
 * Each tick:
 *  1. list fixtures for the target competition that are upcoming or live
 *  2. per fixture: snapshot odds -> normalize -> extend history -> capture
 *  3. integrity-gate the history; skip the fixture on any anomaly
 *  4. run detectShift; on a fresh signal, commit sha256(prediction||nonce)
 *     on-chain and persist {prediction, nonce, tx} atomically to stateFile
 *  5. for committed matches whose scores show game_finalised: reveal, then
 *     settle, then log the agent's on-chain Brier state
 *
 * Crash-safe: state is reloaded on construction, so pending reveals resume
 * after a restart (the nonce is in the state file).
 */
export class AgentRunner {
  private readonly feed: Feed;
  private readonly chain: Chain;
  private readonly pollMs: number;
  private readonly windowSeconds: number;
  private readonly thresholdPct: number;
  private readonly stateFile: string;
  private readonly logFile?: string;
  private readonly capturesDir?: string;
  private readonly competition: string;
  private readonly stakeLamports: number;
  private readonly history = new Map<string, OddsSnapshot[]>();
  private state: RunnerState;
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(options: AgentRunnerOptions) {
    this.feed = options.feed;
    this.chain = options.chain;
    this.pollMs = options.pollMs ?? 30_000;
    this.windowSeconds = options.windowSeconds ?? 300;
    this.thresholdPct = options.thresholdPct ?? 5;
    this.stateFile = options.stateFile;
    this.logFile = options.logFile;
    this.capturesDir = options.capturesDir;
    this.competition = options.competition ?? "World Cup";
    this.stakeLamports = options.stakeLamports ?? 0;
    this.state = this.loadState();
    const pending = Object.values(this.state.matches).filter((m) => m.phase !== "settled");
    this.log("startup", {
      stateFile: this.stateFile,
      knownMatches: Object.keys(this.state.matches).length,
      pendingReveals: pending.map((m) => m.matchId),
    });
  }

  /** Current runner state (read-only view, for tests/inspection). */
  getState(): Readonly<RunnerState> {
    return this.state;
  }

  start(): void {
    if (this.timer) return;
    const loop = () => {
      void this.tick().catch((err) =>
        this.log("tick_error", { error: errorMessage(err) }),
      );
    };
    loop();
    this.timer = setInterval(loop, this.pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private now(): number {
    return this.feed.virtualNowMs?.() ?? Date.now();
  }

  /** One full poll cycle. Public so tests and replay drivers can step manually. */
  async tick(): Promise<void> {
    // Ticks must not overlap: a slow chain call would otherwise let the next
    // interval fire a duplicate commit before state is persisted.
    if (this.ticking) {
      this.log("tick_skipped", { reason: "previous tick still in flight" });
      return;
    }
    this.ticking = true;
    try {
      await this.tickInner();
    } finally {
      this.ticking = false;
    }
  }

  private async tickInner(): Promise<void> {
    const nowMs = this.now();
    let fixtures: Fixture[];
    try {
      fixtures = await this.feed.getFixtures();
    } catch (err) {
      this.log("fixtures_error", { error: errorMessage(err) });
      return;
    }

    const CANCELLED = 6;
    const candidates = fixtures.filter(
      (f) => f.Competition === this.competition && f.GameState !== CANCELLED,
    );
    this.log("tick", {
      nowMs,
      fixtures: fixtures.length,
      candidates: candidates.map((f) => ({
        matchId: f.FixtureId,
        teams: `${f.Participant1} v ${f.Participant2}`,
      })),
    });

    for (const fixture of candidates) {
      await this.processFixture(fixture, nowMs);
    }
    await this.processSettlements();
  }

  private async processFixture(fixture: Fixture, nowMs: number): Promise<void> {
    const matchId = String(fixture.FixtureId);
    const record = this.state.matches[matchId];
    if (record && record.phase === "settled") return;

    let payloads: OddsPayload[];
    try {
      payloads = await this.feed.getOddsSnapshot(matchId);
    } catch (err) {
      this.log("odds_error", { matchId, error: errorMessage(err) });
      return;
    }
    if (this.capturesDir) {
      appendCapture(this.capturesDir, { kind: "odds", matchId, data: payloads });
    }

    const snap = toOddsSnapshot(payloads);
    if (!snap) {
      this.log("no_1x2_market", { matchId });
      return;
    }
    const history = this.history.get(matchId) ?? [];
    const last = history[history.length - 1];
    if (!last || snap.timestamp > last.timestamp) history.push(snap);
    this.history.set(matchId, history);

    const integrity = checkFeedIntegrity(history, nowMs);
    if (!integrity.ok) {
      this.log("integrity_skip", { matchId, reason: integrity.reason });
      return;
    }

    const signal = detectShift(history, this.windowSeconds, this.thresholdPct);
    if (!signal.fired) {
      this.log("no_signal", { matchId, snapshots: history.length, reason: signal.reason, prices: snap.prices });
      return;
    }
    if (record) {
      this.log("signal_already_committed", { matchId, phase: record.phase, reason: signal.reason });
      return;
    }

    // Fresh signal on an uncommitted match: commit on-chain.
    const prediction: Prediction = {
      outcome: outcomeIndex(signal.outcome!),
      confidence_bps: confidenceFromDrift(signal.driftPct!),
    };
    // Nonce is a Vec<u8> on-chain (any length); 32 random bytes gives full
    // preimage resistance for the commit hash.
    const nonce = randomBytes(32);
    const hash = commitHash(prediction, nonce);
    this.log("signal_fired", {
      matchId,
      teams: `${fixture.Participant1} v ${fixture.Participant2}`,
      signal: { outcome: signal.outcome, driftPct: signal.driftPct, direction: signal.direction, reason: signal.reason },
      prediction,
    });
    try {
      const commitTx = await this.chain.commit(BigInt(matchId), hash, BigInt(this.stakeLamports));
      this.state.matches[matchId] = {
        matchId,
        prediction,
        nonce: nonce.toString("hex"),
        commitTx,
        phase: "committed",
        committedAt: new Date().toISOString(),
      };
      this.saveState();
      this.log("committed", {
        matchId,
        prediction,
        commitTx,
        explorer: `https://explorer.solana.com/tx/${commitTx}?cluster=devnet`,
      });
    } catch (err) {
      this.log("commit_error", { matchId, error: errorMessage(err) });
    }
  }

  private async processSettlements(): Promise<void> {
    for (const record of Object.values(this.state.matches)) {
      if (record.phase === "settled") continue;
      let scores: ScoreEvent[];
      try {
        scores = await this.feed.getScores(record.matchId);
      } catch (err) {
        this.log("scores_error", { matchId: record.matchId, error: errorMessage(err) });
        continue;
      }
      const actualOutcome = outcomeFromScore(scores);
      if (actualOutcome === undefined) {
        this.log("awaiting_final", { matchId: record.matchId, phase: record.phase, scoreEvents: scores.length });
        continue;
      }
      await this.revealAndSettle(record, actualOutcome);
    }
  }

  private async revealAndSettle(record: MatchRecord, actualOutcome: number): Promise<void> {
    const matchId = BigInt(record.matchId);
    if (record.phase === "committed") {
      try {
        const revealTx = await this.chain.reveal(
          matchId,
          record.prediction,
          Buffer.from(record.nonce, "hex"),
        );
        record.revealTx = revealTx;
        record.phase = "revealed";
        this.saveState();
        this.log("revealed", {
          matchId: record.matchId,
          prediction: record.prediction,
          revealTx,
          explorer: `https://explorer.solana.com/tx/${revealTx}?cluster=devnet`,
        });
      } catch (err) {
        this.log("reveal_error", { matchId: record.matchId, error: errorMessage(err) });
        return;
      }
    }
    if (record.phase === "revealed") {
      try {
        const settleTx = await this.chain.settle(matchId, actualOutcome);
        record.settleTx = settleTx;
        record.actualOutcome = actualOutcome;
        record.phase = "settled";
        this.saveState();
        this.log("settled", {
          matchId: record.matchId,
          actualOutcome,
          predicted: record.prediction,
          correct: record.prediction.outcome === actualOutcome,
          settleTx,
          explorer: `https://explorer.solana.com/tx/${settleTx}?cluster=devnet`,
        });
      } catch (err) {
        this.log("settle_error", { matchId: record.matchId, error: errorMessage(err) });
        return;
      }
      try {
        const agent = await this.chain.fetchAgent();
        if (agent) {
          this.log("agent_state", {
            totalCommits: agent.totalCommits.toString(),
            revealedCount: agent.revealedCount.toString(),
            cumulativeBrierBps: agent.cumulativeBrierBps.toString(),
            note: "mean Brier = cumulativeBrierBps / settled commits",
          });
        }
      } catch (err) {
        this.log("agent_fetch_error", { error: errorMessage(err) });
      }
    }
  }

  // ---------------------------------------------------------------- state

  private loadState(): RunnerState {
    if (existsSync(this.stateFile)) {
      try {
        return JSON.parse(readFileSync(this.stateFile, "utf8")) as RunnerState;
      } catch (err) {
        this.log("state_load_error", { error: errorMessage(err) });
      }
    }
    return { matches: {} };
  }

  /** Atomic write: temp file + rename, so a crash never corrupts state. */
  private saveState(): void {
    mkdirSync(dirname(this.stateFile), { recursive: true });
    const tmp = `${this.stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8");
    renameSync(tmp, this.stateFile);
  }

  // -------------------------------------------------------------- logging

  /** JSON line to stdout + agent-log.jsonl; the dashboard/demo read these. */
  private log(event: string, data: Record<string, unknown>): void {
    const line = JSON.stringify({ at: new Date().toISOString(), event, ...data });
    console.log(line);
    if (this.logFile) {
      try {
        mkdirSync(dirname(this.logFile), { recursive: true });
        appendFileSync(this.logFile, line + "\n", "utf8");
      } catch {
        // logging must never crash the agent
      }
    }
  }
}
