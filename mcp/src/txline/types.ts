/**
 * TxLINE feed types.
 *
 * Raw API shapes (Fixture, OddsPayload, ScoreEvent) confirmed against LIVE
 * devnet responses on 2026-07-11 (see mcp/scripts/smoke.ts) and the OpenAPI
 * spec v1.5.2 notes in docs/txline-api-notes.md. NOTE: the live API returns
 * PascalCase for scores too, unlike the camelCase in the OpenAPI spec.
 */

/** GET /api/fixtures/snapshot element (real devnet shape). */
export interface Fixture {
  /** Unix ms when this fixture record was published. */
  Ts: number;
  /** Kickoff time, unix ms. */
  StartTime: number;
  Competition: string;
  CompetitionId: number;
  FixtureGroupId: number;
  Participant1Id: number;
  Participant1: string;
  Participant2Id: number;
  Participant2: string;
  FixtureId: number;
  Participant1IsHome: boolean;
  /** Numeric state; observed 1 = Scheduled, docs: 6 = Cancelled. Sometimes absent. */
  GameState?: number;
}

/**
 * GET /api/odds/snapshot/{fixtureId} element (real devnet shape).
 * One record per unique market line, from the StablePrice demargined feed.
 */
export interface OddsPayload {
  FixtureId: number;
  /** e.g. "1837293125:00003:000291-10021-stab" — needed for /api/odds/validation. */
  MessageId: string;
  /** Unix ms of the price. */
  Ts: number;
  /** Observed: "TXLineStablePriceDemargined". */
  Bookmaker: string;
  BookmakerId: number;
  /** Market type, e.g. "1X2_PARTICIPANT_RESULT". */
  SuperOddsType: string;
  GameState: string | null;
  InRunning: boolean;
  MarketParameters: string | null;
  /** null = full time; observed "half=1" for first-half markets. */
  MarketPeriod: string | null;
  /** Outcome labels, e.g. ["part1", "draw", "part2"]. */
  PriceNames: string[];
  /** Decimal odds x 1000 (e.g. 4010 => 4.010), aligned with PriceNames. */
  Prices: number[];
  /** Implied probability %, 3 dp, or "NA" for quarter handicap lines. */
  Pct: string[];
}

/**
 * GET /api/scores/snapshot|updates|historical element (real devnet shape —
 * PascalCase on the wire, unlike the OpenAPI spec's camelCase).
 * Sport-specific extras (ScoreSoccer, Clock, ...) are optional and only
 * loosely typed; unknown extras are preserved via the index signature.
 */
export interface ScoreEvent {
  FixtureId: number;
  /** Observed as a string, e.g. "scheduled". */
  GameState: string;
  /** Kickoff time, unix ms. */
  StartTime: number;
  IsTeam: boolean;
  FixtureGroupId: number;
  CompetitionId: number;
  CountryId: number;
  SportId: number;
  Participant1IsHome: boolean;
  Participant1Id: number;
  Participant2Id: number;
  /** e.g. "comment", "coverage_update", "goal", "game_finalised". */
  Action: string;
  Id: number;
  /** Unix ms of the event. */
  Ts: number;
  ConnectionId: number;
  /** Sequence number within the fixture (>= 1 for real events). */
  Seq: number;
  Data?: Record<string, unknown>;
  Stats?: Record<string, unknown>;
  /** Soccer running score, when present. */
  ScoreSoccer?: { Participant1: number; Participant2: number };
  Clock?: unknown;
  [key: string]: unknown;
}

/**
 * GET /api/scores/stat-validation response (V2). A record plus the Merkle
 * proofs needed to re-verify it against TxODDS's anchored daily-scores root.
 * `ProofNode.hash` is a base64/hex-encoded 32-byte value on the wire.
 */
export interface ProofNode {
  /** 32-byte hash — a raw byte array on devnet, or a hex/base64 string. */
  hash: number[] | string;
  isRightSibling: boolean;
}

export interface ScoreStat {
  key: number;
  value: number;
  period: number;
}

export interface StatValidationResponse {
  ts: number;
  statsToProve: ScoreStat[];
  eventStatRoot: number[] | string;
  summary: {
    fixtureId: number;
    updateStats: { updateCount: number; minTimestamp: number; maxTimestamp: number };
    eventStatsSubTreeRoot: number[] | string;
  };
  statProofs: ProofNode[][];
  subTreeProof: ProofNode[];
  mainTreeProof: ProofNode[];
}

/**
 * DERIVED (not an API shape): one normalized full-time 1X2 point used by the
 * deterministic detector/integrity code. Produced from OddsPayload records
 * via toOddsSnapshot().
 */
export interface OddsSnapshot {
  matchId: string;
  /** Unix epoch milliseconds of the underlying odds record. */
  timestamp: number;
  /** Market identifier, e.g. "1X2_PARTICIPANT_RESULT" (full time). */
  market: string;
  /** Decimal odds per outcome of the 3-way 1X2 market. */
  prices: {
    home: number;
    draw: number;
    away: number;
  };
}

/** TxLINE 1X2 outcome labels -> our home/draw/away slots (part1 is home). */
const OUTCOME_SLOT: Record<string, keyof OddsSnapshot["prices"]> = {
  part1: "home",
  draw: "draw",
  part2: "away",
};

/**
 * Pick the full-time 1X2 market (MarketPeriod === null) out of a raw odds
 * snapshot and normalize it for the detector. Prices are decimal odds x 1000
 * on the wire. Returns undefined if no full-time 1X2 record is present.
 */
export function toOddsSnapshot(payloads: OddsPayload[]): OddsSnapshot | undefined {
  const record = payloads.find(
    (p) => p.SuperOddsType === "1X2_PARTICIPANT_RESULT" && p.MarketPeriod === null,
  );
  if (!record) return undefined;
  const prices: Partial<OddsSnapshot["prices"]> = {};
  record.PriceNames.forEach((name, i) => {
    const slot = OUTCOME_SLOT[name];
    if (slot) prices[slot] = record.Prices[i] / 1000;
  });
  if (prices.home === undefined || prices.draw === undefined || prices.away === undefined) {
    return undefined;
  }
  return {
    matchId: String(record.FixtureId),
    timestamp: record.Ts,
    market: record.SuperOddsType,
    prices: prices as OddsSnapshot["prices"],
  };
}
