/**
 * TxLINE devnet smoke test: fixtures -> odds snapshot -> scores for one fixture,
 * using the real TxLineClient with credentials from <repo>/.env.
 *
 * Run: npx tsx scripts/smoke.ts
 * Pass --capture to also record the odds snapshots to mcp/captures via appendCapture.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TxLineClient } from "../src/txline/client.js";
import { appendCapture } from "../src/recorder.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const CAPTURES_DIR = join(HERE, "..", "captures");

function envVar(name: string): string | undefined {
  const m = readFileSync(join(REPO_ROOT, ".env"), "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  return m?.[1]?.trim() || undefined;
}

const short = (o: unknown, n = 400) => {
  const s = JSON.stringify(o);
  return s.length > n ? s.slice(0, n) + " ..." : s;
};

async function main() {
  const apiToken = envVar("TXLINE_API_TOKEN");
  if (!apiToken) throw new Error("TXLINE_API_TOKEN missing from .env — run txline-setup.ts first");
  const capture = process.argv.includes("--capture");

  const client = new TxLineClient({ env: "devnet", apiToken });

  const todayEpochDay = Math.floor(Date.now() / 86_400_000);
  console.log(`== getFixtures(startEpochDay=${todayEpochDay}) ==`);
  const fixtures = await client.getFixtures(todayEpochDay);
  console.log(`fixtures returned: ${fixtures.length}`);
  for (const f of fixtures.slice(0, 5)) console.log(" ", short(f, 300));

  if (fixtures.length === 0) {
    console.log("No fixtures returned — nothing further to smoke-test.");
    return;
  }

  // Prefer World Cup fixtures (they carry StablePrice odds on devnet), then the
  // one closest to kickoff.
  const sorted = [...fixtures].sort((a, b) => a.StartTime - b.StartTime);
  const pool = sorted.filter((f) => f.Competition === "World Cup");
  const fixture = (pool.length > 0 ? pool : sorted)[0];
  const fixtureId = String(fixture.FixtureId);
  console.log(
    `\nSelected fixture ${fixtureId}: ${fixture.Participant1} vs ${fixture.Participant2}` +
      ` (${fixture.Competition}, start ${new Date(fixture.StartTime).toISOString()})`,
  );

  console.log(`\n== getOddsSnapshot(${fixtureId}) ==`);
  const odds = await client.getOddsSnapshot(fixtureId);
  console.log(`odds records: ${odds.length}`);
  for (const o of odds.slice(0, 3)) console.log(" ", short(o));
  if (capture && odds.length > 0) {
    // Same capture convention ReplayFeed expects: { kind, matchId, data }.
    // Record a few snapshots ~10s apart so the capture has real odds movement.
    appendCapture(CAPTURES_DIR, { kind: "odds", matchId: fixtureId, data: odds });
    for (let i = 0; i < 2; i++) {
      await new Promise((r) => setTimeout(r, 10_000));
      const next = await client.getOddsSnapshot(fixtureId);
      appendCapture(CAPTURES_DIR, { kind: "odds", matchId: fixtureId, data: next });
      console.log(`captured snapshot ${i + 2}: ${next.length} records`);
    }
    console.log(`captured 3 odds snapshots for fixture ${fixtureId} to ${CAPTURES_DIR}`);
  }

  console.log(`\n== getScores(${fixtureId}) ==`);
  const scores = await client.getScores(fixtureId);
  console.log(`score records: ${scores.length}`);
  for (const s of scores.slice(0, 3)) console.log(" ", short(s));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
