/**
 * Tolerant models over the agent's decision log.
 *
 * The runner appends JSON lines to mcp/agent-log.jsonl; the exact field set is
 * still settling, so every field here is optional and unknown fields are
 * ignored. The UI renders whatever is present and never throws on a bad line.
 */

export interface LogEvent {
  ts?: number | string;
  kind?: string; // watch | signal | commit | reveal | settle | skip | ...
  matchId?: number | string;
  fixture?: string;
  outcome?: number; // 0 home, 1 draw, 2 away
  driftPct?: number;
  confidenceBps?: number;
  hash?: string;
  nonce?: string;
  prediction?: unknown;
  commitTx?: string;
  revealTx?: string;
  settleTx?: string;
  brierBps?: number;
  reason?: string;
  probs?: number[]; // implied probabilities [home, draw, away]
  integrityOk?: boolean;
  phase?: string;
  // Runner live-log vocabulary (agent-log.jsonl)
  candidates?: Array<{ matchId?: number | string; teams?: string }>;
  prices?: { home?: number; draw?: number; away?: number };
  snapshots?: number;
}

/** One on-chain commit account, as served by /api/commits. */
export interface ChainCommit {
  matchId?: string;
  agent?: string;
  hash?: string;
  slot?: number;
  ts?: number;
  revealed?: boolean;
  settled?: boolean;
  outcome?: number;
  confidenceBps?: number;
  brierBps?: number;
  /** Which settle instruction closed this commit — "proof" is the trustless,
   *  admin-free path (CPI to the TxODDS oracle). Only known for settled
   *  commits the runner (or an exercise script) logged; not stored on-chain. */
  settlementPath?: "proof" | "admin";
  settleTx?: string;
  /** Lamports escrowed at commit time. Not derivable from chain after
   *  settlement (the escrow account closes), so this comes from the log. */
  stakeLamports?: number;
}

export type Phase = "committed" | "revealed" | "settled" | "unrevealed-loss";

export interface LedgerRow {
  matchId: string;
  fixture: string;
  time?: string;
  outcome?: number;
  driftPct?: number;
  confidenceBps?: number;
  hash?: string;
  nonce?: string;
  prediction?: unknown;
  commitTx?: string;
  revealTx?: string;
  settleTx?: string;
  brierBps?: number;
  phase: Phase;
  settlementPath?: "proof" | "admin";
  stakeLamports?: number;
}

export interface ProbPoint {
  t: number; // epoch ms
  probs: number[]; // [home, draw, away], normalized
}

export interface WatchCard {
  matchId: string;
  fixture: string;
  probs?: number[];
  driftPct?: number;
  integrityOk?: boolean;
  reason?: string;
  time?: string;
  history: ProbPoint[];
}

export interface AgentInfo {
  name?: string;
  pubkey?: string;
  totalCommits?: number;
  revealed?: number;
  brierBps?: number;
  registeredSlot?: number;
}

export const OUTCOME_LABELS = ["Home", "Draw", "Away"] as const;

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
}

function tsMsOf(e: LogEvent): number | undefined {
  if (e.ts === undefined) return undefined;
  const d = typeof e.ts === "number" ? new Date(e.ts) : new Date(String(e.ts));
  return isNaN(d.getTime()) ? undefined : d.getTime();
}

function timeOf(e: LogEvent): string | undefined {
  const ms = tsMsOf(e);
  return ms === undefined ? undefined : new Date(ms).toISOString().slice(11, 19) + " UTC";
}

/** Decimal 1X2 prices -> normalized implied probabilities [home, draw, away]. */
function pricesToProbs(p: { home?: number; draw?: number; away?: number }): number[] | undefined {
  const raw = [p.home, p.draw, p.away];
  if (raw.some((x) => typeof x !== "number" || x <= 1)) return undefined;
  const inv = (raw as number[]).map((x) => 1 / x);
  const sum = inv.reduce((a, b) => a + b, 0);
  return inv.map((x) => x / sum);
}

/** "max drift 0.06pp below threshold 5pp" -> 0.06 */
function driftFromReason(reason?: string): number | undefined {
  const m = reason?.match(/drift\s+(-?\d+(?:\.\d+)?)\s*pp/);
  return m ? Number(m[1]) : undefined;
}

/** Fold raw events into ledger rows (one per committed match) and watch cards. */
export function foldEvents(events: LogEvent[]): {
  rows: LedgerRow[];
  watch: WatchCard[];
  fixtureNames: Map<string, string>;
} {
  const byMatch = new Map<string, LedgerRow>();
  const watch = new Map<string, WatchCard>();
  const fixtureNames = new Map<string, string>();

  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    // Field aliases: the runner logs { at, event, ... }; accept both spellings.
    const r = raw as LogEvent & { at?: string | number; event?: string };
    const e: LogEvent = { ...r, ts: r.ts ?? r.at, kind: r.kind ?? r.event };

    // Tick events carry fixture names for every watched match.
    if (e.candidates) {
      for (const c of e.candidates) {
        const cid = asString(c.matchId);
        if (cid && c.teams) fixtureNames.set(cid, c.teams);
      }
    }

    const id = asString(e.matchId);
    if (!id) continue;

    // Watch cards: any event carrying odds/integrity/market info updates the card.
    const isWatchEvent =
      e.probs !== undefined ||
      e.prices !== undefined ||
      e.integrityOk !== undefined ||
      e.kind === "watch" ||
      e.kind === "skip" ||
      e.kind === "no_signal" ||
      e.kind === "no_1x2_market" ||
      e.kind === "integrity_skip";
    if (isWatchEvent) {
      const w = watch.get(id) ?? { matchId: id, fixture: e.fixture ?? id, history: [] };
      if (e.fixture) w.fixture = e.fixture;
      const probs = e.probs ?? (e.prices ? pricesToProbs(e.prices) : undefined);
      if (probs) {
        w.probs = probs;
        const t = tsMsOf(e);
        if (t !== undefined) {
          w.history.push({ t, probs });
          if (w.history.length > 300) w.history.splice(0, w.history.length - 300);
        }
      }
      const drift = e.driftPct ?? driftFromReason(e.reason);
      if (drift !== undefined) w.driftPct = drift;
      if (e.integrityOk !== undefined) w.integrityOk = e.integrityOk;
      if (e.kind === "integrity_skip") w.integrityOk = false;
      if (e.kind === "no_1x2_market") w.reason = "no 1X2 market on feed";
      else if (e.reason) w.reason = e.reason;
      const t = timeOf(e);
      if (t) w.time = t;
      watch.set(id, w);
    }

    // Ledger rows: only matches that reached a commit (or an explicit loss).
    const hasLedgerFact =
      e.commitTx || e.revealTx || e.settleTx || e.hash || e.phase === "unrevealed-loss";
    if (!hasLedgerFact) continue;

    const row = byMatch.get(id) ?? { matchId: id, fixture: e.fixture ?? id, phase: "committed" as Phase };
    if (e.fixture) row.fixture = e.fixture;
    for (const k of [
      "outcome",
      "driftPct",
      "confidenceBps",
      "hash",
      "nonce",
      "prediction",
      "commitTx",
      "revealTx",
      "settleTx",
      "brierBps",
    ] as const) {
      const v = e[k];
      if (v !== undefined) (row as unknown as Record<string, unknown>)[k] = v;
    }
    const t = timeOf(e);
    if (t && !row.time) row.time = t;

    if (e.phase === "unrevealed-loss") row.phase = "unrevealed-loss";
    else if (row.settleTx) row.phase = row.revealTx ? "settled" : "unrevealed-loss";
    else if (row.revealTx) row.phase = "revealed";
    else row.phase = "committed";

    byMatch.set(id, row);
  }

  // Apply fixture names learned from tick events.
  for (const w of watch.values()) {
    if (w.fixture === w.matchId) w.fixture = fixtureNames.get(w.matchId) ?? w.fixture;
  }
  for (const row of byMatch.values()) {
    if (row.fixture === row.matchId) row.fixture = fixtureNames.get(row.matchId) ?? row.fixture;
  }

  return {
    rows: [...byMatch.values()].reverse(),
    watch: [...watch.values()],
    fixtureNames,
  };
}

/**
 * Merge the on-chain commit ledger with log-derived rows. Chain facts win
 * (phase, hash, score); the local log only adds color the chain doesn't
 * store (tx signatures, drift, nonce, plaintext prediction).
 */
export function mergeChainCommits(
  rows: LedgerRow[],
  commits: ChainCommit[],
  fixtureNames: Map<string, string>,
): LedgerRow[] {
  const byId = new Map(rows.map((r) => [r.matchId, r]));
  for (const c of commits) {
    if (!c.matchId) continue;
    const existing = byId.get(c.matchId);
    const row: LedgerRow = existing ?? {
      matchId: c.matchId,
      fixture: fixtureNames.get(c.matchId) ?? c.matchId,
      phase: "committed",
    };
    if (c.hash) row.hash = c.hash;
    if (c.ts) row.time = new Date(c.ts).toISOString().slice(11, 19) + " UTC";
    if (c.outcome !== undefined) row.outcome = c.outcome;
    if (c.confidenceBps !== undefined) row.confidenceBps = c.confidenceBps;
    if (c.brierBps !== undefined) row.brierBps = c.brierBps;
    if (c.settlementPath !== undefined) row.settlementPath = c.settlementPath;
    if (c.settleTx && !row.settleTx) row.settleTx = c.settleTx;
    if (c.stakeLamports !== undefined) row.stakeLamports = c.stakeLamports;
    row.phase = c.settled
      ? c.revealed
        ? "settled"
        : "unrevealed-loss"
      : c.revealed
        ? "revealed"
        : "committed";
    byId.set(c.matchId, row);
  }
  return [...byId.values()].sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""));
}
