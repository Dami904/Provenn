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
import { PublicKey } from "@solana/web3.js";
import { ProvennChainClient } from "../src/chain/provenn.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOG_FILE = resolve(root, "agent-log.jsonl");
const AGENT_FILE = resolve(root, "agent-state", "agent.json");
const MANIFEST_FILE = resolve(root, "scripts", "settlement-manifest.json");
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

interface LogMeta {
  settlementPath?: "proof" | "admin";
  settleTx?: string;
  stakeLamports?: number;
}

/** Tracked seed for facts a fresh instance's local log wouldn't have — see readLogMeta. */
function readManifest(): Map<string, LogMeta> {
  const meta = new Map<string, LogMeta>();
  if (!existsSync(MANIFEST_FILE)) return meta;
  try {
    const rows = JSON.parse(readFileSync(MANIFEST_FILE, "utf8")) as Array<{
      matchId: string;
      settlementPath?: "proof" | "admin";
      settleTx?: string;
    }>;
    for (const r of rows) meta.set(r.matchId, { settlementPath: r.settlementPath, settleTx: r.settleTx });
  } catch {
    /* malformed manifest — ignore, log-derived meta still applies */
  }
  return meta;
}

/**
 * The chain doesn't record which settle instruction closed a commit (`settle`
 * vs the trustless `settle_with_proof`), nor — once an escrow closes at
 * settlement — how much was staked. Both facts only exist off-chain: the
 * tracked manifest seeds facts from before this deploy (agent-log.jsonl is a
 * gitignored runtime artifact and starts empty on a fresh instance), then the
 * local log's "committed"/"settled" events layer on top (path defaults to
 * "admin" when the log predates the `path` field).
 */
function readLogMeta(): Map<string, LogMeta> {
  const meta = readManifest();
  for (const entry of readLog()) {
    const e = entry as {
      event?: string;
      matchId?: string | number;
      path?: string;
      settleTx?: string;
      stakeLamports?: number;
    };
    if (e.matchId === undefined) continue;
    const id = String(e.matchId);
    const prev = meta.get(id) ?? {};
    if (e.event === "settled") {
      meta.set(id, { ...prev, settlementPath: e.path === "proof" ? "proof" : "admin", settleTx: e.settleTx });
    } else if (e.event === "committed" && e.stakeLamports !== undefined) {
      meta.set(id, { ...prev, stakeLamports: e.stakeLamports });
    }
  }
  return meta;
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
let commitsCache: { at: number; value: unknown } | null = null;
let chainClient: ProvennChainClient | null = null;

let agentsCache: { at: number; value: unknown } | null = null;

/**
 * Everything this server reads is public chain state, so a signing wallet is
 * optional: use one if configured (WALLET_KEYPAIR / ~/.config/solana/id.json),
 * else fall back to a read-only connection. AGENT_AUTHORITY (a pubkey) selects
 * which agent /api/agent shows when there is no wallet.
 */
function getChain(): ProvennChainClient {
  if (!chainClient) {
    try {
      chainClient = ProvennChainClient.connect();
    } catch {
      console.error("[serve-api] no wallet configured — serving chain state read-only");
      chainClient = ProvennChainClient.connectReadOnly();
    }
  }
  return chainClient;
}

function agentAuthority(chain: ProvennChainClient): PublicKey | null {
  if (process.env.AGENT_AUTHORITY) return new PublicKey(process.env.AGENT_AUTHORITY);
  return chain.readOnly ? null : chain.wallet.publicKey;
}

/** The open registry — every agent account, ranked by mean Brier. */
async function readAgents(): Promise<unknown> {
  if (agentsCache && Date.now() - agentsCache.at < AGENT_CACHE_MS) return agentsCache.value;
  try {
    const agents = await getChain().allAgents();
    const value = agents
      .map((a) => ({
        name: a.name,
        pubkey: a.authority.toString(),
        totalCommits: Number(a.totalCommits),
        revealed: Number(a.revealedCount),
        brierBps: Number(a.cumulativeBrierBps),
      }))
      .sort((x, y) => {
        const mx = x.totalCommits ? x.brierBps / x.totalCommits : Infinity;
        const my = y.totalCommits ? y.brierBps / y.totalCommits : Infinity;
        return mx - my;
      });
    agentsCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.error(`[serve-api] on-chain agents fetch failed: ${err instanceof Error ? err.message : err}`);
    return agentsCache?.value ?? [];
  }
}

/** The on-chain commit ledger — every commit account on the program. */
async function readCommits(): Promise<unknown> {
  if (commitsCache && Date.now() - commitsCache.at < AGENT_CACHE_MS) return commitsCache.value;
  try {
    const commits = await getChain().allCommits();
    const logMeta = readLogMeta();
    const value = commits
      .map((c) => {
        const matchId = c.matchId.toString();
        const meta = logMeta.get(matchId);
        return {
          matchId,
          agent: c.agent.toString(),
          hash: Buffer.from(c.predictionHash).toString("hex"),
          slot: Number(c.slot),
          ts: Number(c.unixTimestamp) * 1000,
          revealed: c.revealed,
          settled: c.settled,
          outcome: c.revealed ? c.prediction.outcome : undefined,
          confidenceBps: c.revealed ? c.prediction.confidence_bps : undefined,
          brierBps: c.settled ? Number(c.brierBps) : undefined,
          settlementPath: c.settled ? meta?.settlementPath : undefined,
          settleTx: c.settled ? meta?.settleTx : undefined,
          stakeLamports: meta?.stakeLamports,
        };
      })
      .sort((a, b) => b.slot - a.slot);
    commitsCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.error(`[serve-api] on-chain commits fetch failed: ${err instanceof Error ? err.message : err}`);
    return commitsCache?.value ?? [];
  }
}

async function readAgent(): Promise<unknown> {
  if (agentCache && Date.now() - agentCache.at < AGENT_CACHE_MS) return agentCache.value;
  try {
    const chain = getChain();
    const authority = agentAuthority(chain);
    const a = authority ? await chain.fetchAgent(authority) : undefined;
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
  } else if (req.url === "/api/commits") {
    void readCommits().then(
      (commits) => res.writeHead(200, headers).end(JSON.stringify(commits)),
      () => res.writeHead(200, headers).end("[]"),
    );
  } else if (req.url === "/api/agents") {
    void readAgents().then(
      (agents) => res.writeHead(200, headers).end(JSON.stringify(agents)),
      () => res.writeHead(200, headers).end("[]"),
    );
  } else {
    res.writeHead(404, headers).end(JSON.stringify({ error: "not found" }));
  }
}).listen(PORT, () => {
  console.log(`provenn dashboard api on :${PORT} (log: ${LOG_FILE})`);
});
