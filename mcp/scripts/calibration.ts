/**
 * Calibration backtest: run the deterministic drift detector over the pre-match
 * odds of every completed World Cup fixture, compare each fired signal's
 * confidence to whether it was actually right, and emit a calibration table +
 * SVG. This is the honest answer to "is confidenceFromDrift calibrated?".
 *
 *   npx tsx scripts/calibration.ts [thresholdPct]
 *
 * Writes app/public/calibration.svg (served by the dashboard) and prints the
 * reliability table.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TxLineClient } from "../src/txline/client.js";
import { toOddsSnapshot, type OddsSnapshot } from "../src/txline/types.js";
import { detectShift } from "../src/signal/detector.js";
import { confidenceFromDrift, outcomeFromScore, outcomeIndex } from "../src/agent/prediction.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(REPO_ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const WORLD_CUP = 72;
const OFFSETS_MIN = [90, 70, 50, 35, 25, 15, 8, 3]; // pre-match sample points
const WINDOW_SECONDS = 3 * 3600; // compare open-of-window to close over ~pre-match
const MAX_BRIER = 10_000;

interface Signal {
  matchId: string;
  predicted: number;
  confidenceBps: number;
  actual: number;
  correct: boolean;
  brierBps: number;
}

async function seriesFor(client: TxLineClient, id: string, kickoff: number): Promise<OddsSnapshot[]> {
  const series: OddsSnapshot[] = [];
  for (const off of OFFSETS_MIN) {
    try {
      const odds = await client.getOddsSnapshot(id, kickoff - off * 60_000);
      const snap = toOddsSnapshot(odds);
      if (snap && (series.length === 0 || snap.timestamp !== series[series.length - 1].timestamp)) {
        series.push({ ...snap, timestamp: kickoff - off * 60_000 });
      }
    } catch {
      /* older than odds retention, or gap — skip this point */
    }
  }
  return series;
}

async function main(): Promise<void> {
  const thresholdPct = Number(process.argv[2] ?? 3);
  const env = loadEnv();
  const client = new TxLineClient({ env: "devnet", apiToken: env.TXLINE_API_TOKEN });

  const fixtures = await client.getFixtures(Math.floor(Date.now() / 86_400_000) - 25, WORLD_CUP);
  console.log(`Scanning ${fixtures.length} World Cup fixtures (threshold ${thresholdPct}pp)…`);

  const signals: Signal[] = [];
  let finished = 0;
  let withOdds = 0;
  for (const f of fixtures) {
    const id = String(f.FixtureId);
    let actual: number | undefined;
    try {
      actual = outcomeFromScore(await client.getScores(id));
    } catch {
      continue;
    }
    if (actual === undefined) continue;
    finished++;

    const series = await seriesFor(client, id, f.StartTime);
    if (series.length >= 2) withOdds++;
    const sig = detectShift(series, WINDOW_SECONDS, thresholdPct);
    if (!sig.fired) continue;

    const predicted = outcomeIndex(sig.outcome!);
    const confidenceBps = confidenceFromDrift(sig.driftPct!);
    const correct = predicted === actual;
    const brierBps = correct
      ? Math.floor(((MAX_BRIER - confidenceBps) ** 2) / MAX_BRIER)
      : Math.floor((confidenceBps ** 2) / MAX_BRIER);
    signals.push({ matchId: id, predicted, confidenceBps, actual, correct, brierBps });
    process.stdout.write(`  ${id}: signal ${["P1", "draw", "P2"][predicted]} @ ${(confidenceBps / 100).toFixed(0)}% → ${correct ? "✓" : "✗"}\n`);
  }

  console.log(`\nfinished matches: ${finished}, with usable odds series: ${withOdds}, signals fired: ${signals.length}`);
  if (signals.length === 0) {
    console.log("No signals fired — odds were stable across the sampled matches. Try a lower threshold: npx tsx scripts/calibration.ts 2");
    return;
  }

  // Reliability buckets by predicted confidence.
  const buckets = [
    { lo: 5000, hi: 6000 },
    { lo: 6000, hi: 7000 },
    { lo: 7000, hi: 8000 },
    { lo: 8000, hi: 9001 },
  ];
  console.log("\nconfidence bucket   n   predicted   empirical hit-rate");
  const points: Array<{ x: number; y: number; n: number }> = [];
  for (const b of buckets) {
    const inB = signals.filter((s) => s.confidenceBps >= b.lo && s.confidenceBps < b.hi);
    if (inB.length === 0) continue;
    const hit = inB.filter((s) => s.correct).length / inB.length;
    const meanConf = inB.reduce((a, s) => a + s.confidenceBps, 0) / inB.length / 10000;
    console.log(
      `  ${(b.lo / 100).toFixed(0)}–${(b.hi / 100).toFixed(0)}%          ${String(inB.length).padStart(2)}   ${(meanConf * 100).toFixed(0)}%        ${(hit * 100).toFixed(0)}%`,
    );
    points.push({ x: meanConf, y: hit, n: inB.length });
  }
  const overallBrier = signals.reduce((a, s) => a + s.brierBps, 0) / signals.length / 10000;
  const hitRate = signals.filter((s) => s.correct).length / signals.length;
  console.log(`\noverall: ${signals.length} signals, hit-rate ${(hitRate * 100).toFixed(0)}%, mean Brier ${overallBrier.toFixed(3)}`);

  writeSvg(points, signals.length, hitRate, overallBrier);
}

function writeSvg(points: Array<{ x: number; y: number; n: number }>, n: number, hit: number, brier: number): void {
  const W = 460, H = 460, P = 60;
  const sx = (x: number) => P + x * (W - 2 * P);
  const sy = (y: number) => H - P - y * (H - 2 * P);
  const dots = points
    .map((p) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${(4 + p.n * 1.6).toFixed(1)}" fill="#24559c" fill-opacity="0.75"/>`)
    .join("");
  const line = points.length >= 2
    ? `<polyline points="${points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ")}" fill="none" stroke="#24559c" stroke-width="2"/>`
    : "";
  const ticks = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    .map((t) => `<text x="${sx(t)}" y="${H - P + 18}" font-size="11" text-anchor="middle" fill="#676d73">${(t * 100).toFixed(0)}%</text>` +
      `<text x="${P - 12}" y="${sy(t) + 4}" font-size="11" text-anchor="end" fill="#676d73">${(t * 100).toFixed(0)}%</text>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,sans-serif">
  <rect width="${W}" height="${H}" fill="#fafaf7"/>
  <line x1="${sx(0.5)}" y1="${sy(0.5)}" x2="${sx(1)}" y2="${sy(1)}" stroke="#c9c6ba" stroke-width="1.5" stroke-dasharray="5 4"/>
  <line x1="${P}" y1="${P}" x2="${P}" y2="${H - P}" stroke="#16181a" stroke-width="1.5"/>
  <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#16181a" stroke-width="1.5"/>
  ${ticks}${line}${dots}
  <text x="${W / 2}" y="${H - 14}" font-size="12" text-anchor="middle" fill="#16181a">predicted confidence</text>
  <text x="18" y="${H / 2}" font-size="12" text-anchor="middle" fill="#16181a" transform="rotate(-90 18 ${H / 2})">actual hit-rate</text>
  <text x="${W / 2}" y="26" font-size="14" font-weight="700" text-anchor="middle" fill="#16181a">Provenn signal calibration</text>
  <text x="${W / 2}" y="43" font-size="11" text-anchor="middle" fill="#676d73">${n} signals · hit-rate ${(hit * 100).toFixed(0)}% · mean Brier ${brier.toFixed(3)} · dashed = perfect calibration</text>
</svg>`;
  const out = join(REPO_ROOT, "app", "public", "calibration.svg");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, svg);
  console.log(`\nwrote ${out}`);
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
