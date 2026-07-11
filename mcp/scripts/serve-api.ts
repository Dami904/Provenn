/**
 * Minimal dashboard API — node builtins only, zero dependencies.
 *
 *   npx tsx scripts/serve-api.ts        (port 8787)
 *
 * GET /api/log    -> agent-log.jsonl parsed to a JSON array ([] if absent)
 * GET /api/agent  -> agent-state/agent.json contents (null if absent)
 *
 * Expected agent.json shape (maintained by the runner):
 *   { name, pubkey, totalCommits, revealed, brierBps, registeredSlot }
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

function readAgent(): unknown {
  if (!existsSync(AGENT_FILE)) return null;
  try {
    return JSON.parse(readFileSync(AGENT_FILE, "utf8"));
  } catch {
    return null;
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
    res.writeHead(200, headers).end(JSON.stringify(readAgent()));
  } else {
    res.writeHead(404, headers).end(JSON.stringify({ error: "not found" }));
  }
}).listen(PORT, () => {
  console.log(`provenn dashboard api on :${PORT} (log: ${LOG_FILE})`);
});
