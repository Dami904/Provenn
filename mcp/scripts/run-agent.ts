/**
 * Provenn autonomous agent CLI.
 *
 *   npx tsx scripts/run-agent.ts                         # live TxLINE devnet feed
 *   npx tsx scripts/run-agent.ts --replay <file> [--speed 60]
 *   npx tsx scripts/run-agent.ts --register              # one-time agent registration
 *
 * Live mode reads TXLINE_ENV / TXLINE_API_TOKEN from the repo-root .env.
 * The wallet is ~/.config/solana/id.json (devnet).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentRunner, type Feed } from "../src/agent/runner.js";
import { DEVNET_RPC, ProvennChainClient } from "../src/chain/provenn.js";
import { ReplayFeed } from "../src/replay.js";
import { TxLineClient } from "../src/txline/client.js";

const MCP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(MCP_ROOT, "..");

function loadDotEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    for (const line of readFileSync(join(REPO_ROOT, ".env"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {
    // fall through to process.env
  }
  return { ...env, ...(process.env as Record<string, string>) };
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (flag: string) => process.argv.includes(flag);

async function main(): Promise<void> {
  const chain = ProvennChainClient.connect(DEVNET_RPC);
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      event: "cli_start",
      wallet: chain.wallet.publicKey.toBase58(),
      agentPda: chain.agentPda().toBase58(),
    }),
  );

  if (hasFlag("--register")) {
    // Strategy hash = sha256 of the detector source. This binds the on-chain
    // agent identity to the EXACT decision code: anyone can re-hash
    // src/signal/detector.ts and verify the registered strategy is the one
    // that produced every commit. Changing the strategy changes the hash,
    // which would require a new agent registration — no silent strategy swaps.
    const detectorSource = readFileSync(join(MCP_ROOT, "src/signal/detector.ts"));
    const strategyHash = new Uint8Array(createHash("sha256").update(detectorSource).digest());
    const existing = await chain.fetchAgent();
    if (existing) {
      console.log(JSON.stringify({ event: "already_registered", name: existing.name }));
      return;
    }
    const tx = await chain.registerAgent("provenn-wc-agent", strategyHash);
    console.log(
      JSON.stringify({
        event: "registered",
        name: "provenn-wc-agent",
        strategyHash: Buffer.from(strategyHash).toString("hex"),
        tx,
        explorer: `https://explorer.solana.com/tx/${tx}?cluster=devnet`,
      }),
    );
    return;
  }

  const replayFile = arg("--replay");
  let feed: Feed;
  if (replayFile) {
    const speed = Number(arg("--speed") ?? "60");
    feed = new ReplayFeed(resolve(replayFile), { speed });
    console.log(JSON.stringify({ event: "feed_mode", mode: "replay", file: resolve(replayFile), speed }));
  } else {
    const env = loadDotEnv();
    const txEnv = (env.TXLINE_ENV ?? "devnet") as "devnet" | "mainnet";
    feed = new TxLineClient({ env: txEnv, apiToken: env.TXLINE_API_TOKEN });
    console.log(JSON.stringify({ event: "feed_mode", mode: "live", env: txEnv }));
  }

  const runner = new AgentRunner({
    feed,
    chain,
    pollMs: Number(arg("--poll-ms") ?? (replayFile ? "2000" : "30000")),
    windowSeconds: Number(arg("--window") ?? "300"),
    thresholdPct: Number(arg("--threshold") ?? "5"),
    stateFile: arg("--state") ?? join(MCP_ROOT, "agent-state.json"),
    logFile: join(MCP_ROOT, "agent-log.jsonl"),
    capturesDir: replayFile ? undefined : join(MCP_ROOT, "captures"),
  });

  runner.start();
  const shutdown = () => {
    runner.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
