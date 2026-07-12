/**
 * Probe: can we reconstruct a pre-match odds time series for a finished match
 * via getOddsSnapshot(id, asOf)? Needed for the calibration backtest.
 *
 *   npx tsx scripts/probe-odds-history.ts <fixtureId>
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TxLineClient } from "../src/txline/client.js";
import { toOddsSnapshot } from "../src/txline/types.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(REPO_ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

async function main() {
  const fixtureId = process.argv[2] ?? "18213979";
  const env = loadEnv();
  const client = new TxLineClient({ env: "devnet", apiToken: env.TXLINE_API_TOKEN });

  const fixtures = await client.getFixtures(Math.floor(Date.now() / 86_400_000) - 25, 72);
  const fx = fixtures.find((f) => String(f.FixtureId) === fixtureId);
  const kickoff = fx?.StartTime;
  console.log(`fixture ${fixtureId} kickoff=${kickoff ? new Date(kickoff).toISOString() : "?"}`);
  if (!kickoff) return;

  // Sample odds at several times in the hour before kickoff.
  const offsetsMin = [60, 45, 30, 20, 10, 5, 1];
  const distinctMarkets = new Set<string>();
  for (const off of offsetsMin) {
    const asOf = kickoff - off * 60_000;
    let markets = 0;
    let ft1x2: string | undefined;
    try {
      const odds = await client.getOddsSnapshot(fixtureId, asOf);
      markets = odds.length;
      for (const o of odds) distinctMarkets.add(`${o.SuperOddsType}|${o.MarketPeriod ?? "FT"}`);
      const snap = toOddsSnapshot(odds);
      if (snap) ft1x2 = `H${snap.prices.home.toFixed(2)} D${snap.prices.draw.toFixed(2)} A${snap.prices.away.toFixed(2)}`;
    } catch (e) {
      console.log(`  -${off}m: error ${e instanceof Error ? e.message : e}`);
      continue;
    }
    console.log(`  -${String(off).padStart(2)}m: ${markets} records  ${ft1x2 ? "1X2=" + ft1x2 : "(no full-time 1X2)"}`);
  }
  console.log(`\ndistinct markets seen: ${[...distinctMarkets].join(", ") || "none"}`);
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
