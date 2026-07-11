/**
 * Minimal dashboard API.
 *
 *   npx tsx scripts/serve-api.ts        (port 8787, or $PORT)
 *
 * GET /api/log    -> agent-log.jsonl parsed to a JSON array ([] if absent)
 * GET /api/agent  -> the agent's ON-CHAIN account state (cached 60s; the
 *                    chain is the source of truth for the track record),
 *                    falling back to agent-state/agent.json, else null
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ProvennChainClient } from "../src/chain/provenn.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOG_FILE = resolve(root, "agent-log.jsonl");
const AGENT_FILE = resolve(root, "agent-state", "agent.json");
const PORT = Number(process.env.PORT ?? 8787);

function readLog(): unknown[] {
  if (!existsSync(LOG_FILE)) return [];
  const out: unknown[] = [];
  for (const line of readFileSync(LOG_FILE, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines — the log is append-only and may race a writer
    }
  }
  return out;
}

function readAgentFile(): unknown {
  if (!existsSync(AGENT_FILE)) return null;
  try {
    return JSON.parse(readFileSync(AGENT_FILE, "utf8"));
  } catch {
    return null;
  }
}

const AGENT_CACHE_MS = 60_000;
let agentCache: { at: number; value: unknown } | null = null;
let chainClient: ProvennChainClient | null = null;

async function readAgent(): Promise<unknown> {
  if (agentCache && Date.now() - agentCache.at < AGENT_CACHE_MS) return agentCache.value;
  try {
    chainClient ??= await ProvennChainClient.connect();
    const a = await chainClient.fetchAgent();
    const value = a
      ? {
          name: a.name,
          pubkey: a.authority.toString(),
          totalCommits: Number(a.totalCommits),
          revealed: Number(a.revealedCount),
          brierBps: Number(a.cumulativeBrierBps),
        }
      : readAgentFile();
    agentCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.error(`[serve-api] on-chain agent fetch failed: ${err instanceof Error ? err.message : err}`);
    return readAgentFile();
  }
}

createServer((req, res) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  };
  if (req.method !== "GET") {
    res.writeHead(405, headers).end(JSON.stringify({ error: "GET only" }));
    return;
  }
  if (req.url === "/api/log") {
    res.writeHead(200, headers).end(JSON.stringify(readLog()));
  } else if (req.url === "/api/agent") {
    void readAgent().then(
      (agent) => res.writeHead(200, headers).end(JSON.stringify(agent ?? null)),
      () => res.writeHead(200, headers).end("null"),
    );
  } else {
    res.writeHead(404, headers).end(JSON.stringify({ error: "not found" }));
  }
}).listen(PORT, () => {
  console.log(`provenn dashboard api on :${PORT} (log: ${LOG_FILE})`);
});
