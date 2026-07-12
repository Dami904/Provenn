/**
 * Discovery: list World Cup fixtures, find COMPLETED ones (final score present),
 * derive the 1X2 outcome, and inspect what odds markets are available (so we
 * can identify the Over/Under market type for a second signal).
 *
 *   npx tsx scripts/discover-matches.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TxLineClient } from "../src/txline/client.js";
import { outcomeFromScore } from "../src/agent/prediction.js";
import type { OddsPayload } from "../src/txline/types.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    for (const line of readFileSync(join(REPO_ROOT, ".env"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {
    /* ignore */
  }
  return env;
}

const WORLD_CUP_COMPETITION_ID = 72;

async function main(): Promise<void> {
  const env = loadEnv();
  const client = new TxLineClient({
    env: (env.TXLINE_ENV as "devnet" | "mainnet") || "devnet",
    apiToken: env.TXLINE_API_TOKEN,
  });

  // Look back across the tournament: fixtures starting on/after ~25 days ago.
  const startEpochDay = Math.floor(Date.now() / 86_400_000) - 25;
  const fixtures = await client.getFixtures(startEpochDay, WORLD_CUP_COMPETITION_ID);
  console.log(`World Cup fixtures from epochDay ${startEpochDay}: ${fixtures.length}`);

  const completed: Array<{ id: string; teams: string; score: string; outcome: number; ts: number }> = [];
  const actionTally = new Map<string, number>();
  let withScores = 0;
  let sampled = 0;
  for (const f of fixtures) {
    const id = String(f.FixtureId);
    let scores;
    try {
      scores = await client.getScores(id); // snapshot: latest per action type, not window-limited
    } catch {
      try {
        scores = await client.getScoresHistorical(id);
      } catch {
        continue;
      }
    }
    if (scores.length) withScores++;
    for (const s of scores) actionTally.set(s.Action, (actionTally.get(s.Action) ?? 0) + 1);
    // Debug: dump the FULL raw game_finalised event once, to locate the score.
    const gf = scores.find((s) => s.Action === "game_finalised");
    if (gf && sampled < 1) {
      sampled++;
      console.log(`\n[raw game_finalised for ${id}]\n${JSON.stringify(gf, null, 1)}\n`);
    }
    // Debug: show the raw shape of the first few matches that carry a score.
    const anyScore = scores.find((s) => s.ScoreSoccer);
    if (anyScore && sampled < 3) {
      sampled++;
      console.log(
        `  [sample ${id}] actions=${[...new Set(scores.map((s) => s.Action))].join("|")}  ` +
          `latestScore=${JSON.stringify(anyScore.ScoreSoccer)}  statusIds=${[...new Set(scores.map((s) => s.StatusId))].join(",")}`,
      );
    }
    const outcome = outcomeFromScore(scores);
    if (outcome === undefined) continue;
    const final = scores.filter((s) => s.Action === "game_finalised").pop();
    const sc = final?.ScoreSoccer;
    completed.push({
      id,
      teams: `${f.Participant1} v ${f.Participant2}`,
      score: sc ? `${sc.Participant1}-${sc.Participant2}` : "?",
      outcome,
      ts: f.StartTime,
    });
  }
  console.log(`\nfixtures with ≥1 score record: ${withScores}`);
  console.log(`action types seen: ${[...actionTally.entries()].map(([a, n]) => `${a}:${n}`).join(", ")}`);

  completed.sort((a, b) => a.ts - b.ts);
  console.log(`\nCOMPLETED matches with a final score (${completed.length}):`);
  const label = ["P1 win", "draw", "P2 win"];
  for (const c of completed) {
    console.log(`  ${c.id}  ${c.teams.padEnd(34)} ${c.score.padEnd(6)} → ${label[c.outcome]}`);
  }

  // Show the 12 most recent completed matches (candidates for settle_with_proof).
  for (const c of completed.slice(-12)) {
    console.log(
      `  ${c.id}  ${new Date(c.ts).toISOString().slice(0, 10)}  ${c.teams.padEnd(30)} ${c.score.padEnd(6)} → ${label[c.outcome]}`,
    );
  }

  // Inspect odds markets — walk recent completed matches until one returns odds.
  for (const probe of [...completed].reverse().slice(0, 8)) {
    let odds: OddsPayload[] = [];
    try {
      odds = await client.getOddsSnapshot(probe.id);
    } catch {
      continue;
    }
    if (odds.length === 0) continue;
    console.log(`\nOdds markets for ${probe.id} (${probe.teams}) — ${odds.length} records:`);
    const markets = new Map<string, { period: string | null; names: string[] }>();
    for (const o of odds) {
      const k = `${o.SuperOddsType}|${o.MarketPeriod ?? "FT"}|${o.MarketParameters ?? ""}`;
      if (!markets.has(k)) markets.set(k, { period: o.MarketPeriod, names: o.PriceNames });
    }
    for (const [k, info] of markets) {
      console.log(`  ${k.split("|")[0]}  period=${info.period ?? "FT"}  params=${k.split("|")[2] || "—"}  names=[${info.names.join(", ")}]`);
    }
    break;
  }
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
