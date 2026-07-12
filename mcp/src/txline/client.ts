import type { Fixture, OddsPayload, ScoreEvent, StatValidationResponse } from "./types.js";

/**
 * Every TxLINE path lives here so corrections are one-line edits.
 * Paths verified against the TxLINE OpenAPI spec v1.5.2 (docs/txline-api-notes.md).
 * NOTE: guest/start is at the HOST ROOT; all data endpoints are under /api/.
 */
const ENDPOINTS = {
  guestStart: "auth/guest/start",
  /** Latest fixtures starting on/after startEpochDay (optional competitionId filter). */
  fixtures: "api/fixtures/snapshot",
  /** Latest odds per unique market for a fixture; optional ?asOf=<ms> for historical snapshots. */
  oddsSnapshot: "api/odds/snapshot/{fixtureId}",
  /** Latest score event per fixture; optional ?asOf=<ms>. */
  scores: "api/scores/snapshot/{fixtureId}",
  /** FULL score-update sequence for one fixture (retention: ~6h–2wk after start). */
  scoresHistorical: "api/scores/historical/{fixtureId}",
  /** Merkle proof for specific stats of a fixture, against TxODDS's daily root. */
  scoreStatValidation: "api/scores/stat-validation",
} as const;

const BASE_URLS = {
  devnet: "https://txline-dev.txodds.com/",
  mainnet: "https://txline.txodds.com/",
} as const;

export interface TxLineClientOptions {
  env: "devnet" | "mainnet";
  /** Optional API token sent as X-Api-Token on every request. */
  apiToken?: string;
}

/**
 * Minimal TxLINE HTTP client.
 *
 * Auth model: a guest JWT (Bearer) obtained via startGuestSession(), plus an
 * optional X-Api-Token header. On a 401 the client refreshes the guest JWT
 * once and retries the request.
 */
export class TxLineClient {
  private readonly baseUrl: string;
  private readonly apiToken?: string;
  private jwt?: string;

  constructor(options: TxLineClientOptions) {
    this.baseUrl = BASE_URLS[options.env];
    this.apiToken = options.apiToken;
  }

  /** POST /auth/guest/start — obtain a guest session JWT. */
  async startGuestSession(): Promise<void> {
    const res = await fetch(this.baseUrl + ENDPOINTS.guestStart, {
      method: "POST",
      headers: this.headers(false),
    });
    if (!res.ok) {
      throw new Error(`TxLINE guest session failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as Record<string, unknown>;
    // Confirmed live (2026-07-11): response is {"token": "<jwt>"}.
    const token = body.token as string | undefined;
    if (!token) {
      throw new Error("TxLINE guest session response missing token field");
    }
    this.jwt = token;
  }

  /** List fixtures starting on/after startEpochDay (days since Unix epoch, UTC). */
  async getFixtures(startEpochDay?: number, competitionId?: number): Promise<Fixture[]> {
    const q = new URLSearchParams();
    if (startEpochDay !== undefined) q.set("startEpochDay", String(startEpochDay));
    if (competitionId !== undefined) q.set("competitionId", String(competitionId));
    const qs = q.size ? `?${q}` : "";
    return this.get<Fixture[]>(ENDPOINTS.fixtures + qs);
  }

  /** Latest odds per unique market line; pass asOfMs for a historical snapshot. */
  async getOddsSnapshot(matchId: string, asOfMs?: number): Promise<OddsPayload[]> {
    const path = ENDPOINTS.oddsSnapshot.replace("{fixtureId}", encodeURIComponent(matchId));
    return this.get<OddsPayload[]>(asOfMs !== undefined ? `${path}?asOf=${asOfMs}` : path);
  }

  /** Latest score event for a fixture; pass asOfMs for a historical snapshot. */
  async getScores(matchId: string, asOfMs?: number): Promise<ScoreEvent[]> {
    const path = ENDPOINTS.scores.replace("{fixtureId}", encodeURIComponent(matchId));
    return this.get<ScoreEvent[]>(asOfMs !== undefined ? `${path}?asOf=${asOfMs}` : path);
  }

  /** Full score-update sequence for a finished fixture (TxLINE retains ~2 weeks after kickoff). */
  async getScoresHistorical(matchId: string): Promise<ScoreEvent[]> {
    return this.get<ScoreEvent[]>(ENDPOINTS.scoresHistorical.replace("{fixtureId}", encodeURIComponent(matchId)));
  }

  /**
   * Merkle validation for specific stats of a fixture (V2 statKeys form).
   * Returns the record + sub-tree/main-tree proofs needed to re-verify against
   * TxODDS's anchored daily-scores root — the raw material for trustless
   * settlement (see ProvennChainClient.settleWithProof).
   */
  async getScoreStatValidation(
    fixtureId: string,
    seq: number,
    statKeys: number[],
  ): Promise<StatValidationResponse> {
    const q = new URLSearchParams({
      fixtureId,
      seq: String(seq),
      statKeys: statKeys.join(","),
    });
    return this.get<StatValidationResponse>(`${ENDPOINTS.scoreStatValidation}?${q}`);
  }

  private headers(includeJwt = true): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (includeJwt && this.jwt) h.Authorization = `Bearer ${this.jwt}`;
    if (this.apiToken) h["X-Api-Token"] = this.apiToken;
    return h;
  }

  private async get<T>(path: string, retried = false): Promise<T> {
    if (!this.jwt) await this.startGuestSession();
    const res = await fetch(this.baseUrl + path, { headers: this.headers() });
    if (res.status === 401 && !retried) {
      // JWT expired — refresh the guest session once and retry.
      await this.startGuestSession();
      return this.get<T>(path, true);
    }
    if (!res.ok) {
      throw new Error(`TxLINE request failed: GET ${path} -> ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }
}
