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
}

export interface WatchCard {
  matchId: string;
  fixture: string;
  probs?: number[];
  driftPct?: number;
  integrityOk?: boolean;
  reason?: string;
  time?: string;
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

function timeOf(e: LogEvent): string | undefined {
  if (e.ts === undefined) return undefined;
  const d = typeof e.ts === "number" ? new Date(e.ts) : new Date(String(e.ts));
  return isNaN(d.getTime()) ? undefined : d.toISOString().slice(11, 19) + " UTC";
}

/** Fold raw events into ledger rows (one per committed match) and watch cards. */
export function foldEvents(events: LogEvent[]): { rows: LedgerRow[]; watch: WatchCard[] } {
  const byMatch = new Map<string, LedgerRow>();
  const watch = new Map<string, WatchCard>();

  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    // Field aliases: the runner logs { at, event, ... }; accept both spellings.
    const r = raw as LogEvent & { at?: string | number; event?: string };
    const e: LogEvent = { ...r, ts: r.ts ?? r.at, kind: r.kind ?? r.event };
    const id = asString(e.matchId);
    if (!id) continue;

    // Watch cards: any event carrying odds/integrity info updates the card.
    if (e.probs || e.integrityOk !== undefined || e.kind === "watch" || e.kind === "skip") {
      const w = watch.get(id) ?? { matchId: id, fixture: e.fixture ?? id };
      if (e.fixture) w.fixture = e.fixture;
      if (e.probs) w.probs = e.probs;
      if (e.driftPct !== undefined) w.driftPct = e.driftPct;
      if (e.integrityOk !== undefined) w.integrityOk = e.integrityOk;
      if (e.reason) w.reason = e.reason;
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

  return {
    rows: [...byMatch.values()].reverse(),
    watch: [...watch.values()],
  };
}
