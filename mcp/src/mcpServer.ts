import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TxLineClient } from "./txline/client.js";
import { toOddsSnapshot, type OddsSnapshot } from "./txline/types.js";
import { detectShift } from "./signal/detector.js";
import { checkFeedIntegrity } from "./signal/integrity.js";
import { appendCapture } from "./recorder.js";

const CAPTURES_DIR = new URL("../../captures/", import.meta.url).pathname;

/**
 * Module-level singletons, not per-server state: a Protocol/Server instance
 * can only ever be connected to one transport, so the HTTP entrypoint must
 * build a fresh McpServer per request (see mcpHttp.ts). The feed client and
 * accumulated odds history still need to persist ACROSS those requests (a
 * client's get_live_odds / detect_odds_shift calls arrive as separate HTTP
 * requests), so they live here at module scope instead of inside the
 * factory below.
 */
const client = new TxLineClient({
  env: (process.env.TXLINE_ENV as "devnet" | "mainnet") ?? "devnet",
  apiToken: process.env.TXLINE_API_TOKEN,
});

/** In-memory odds history per match, fed by get_live_odds calls. */
const oddsHistory = new Map<string, OddsSnapshot[]>();

/**
 * Builds a fresh Provenn MCP server instance: the TxLINE World Cup feed and
 * the deterministic odds-shift detector exposed as MCP tools. Call once per
 * transport connection (stdio: once per process; HTTP: once per request —
 * see the two entrypoints, index.ts and mcpHttp.ts).
 */
export function createProvennMcpServer(): McpServer {
  function json(payload: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
  }

  const server = new McpServer({ name: "provenn-mcp", version: "0.1.0" });

  server.registerTool(
    "get_match_schedule",
    {
      description: "List upcoming and live World Cup fixtures from the TxLINE feed.",
      inputSchema: {},
    },
    async () => {
      const fixtures = await client.getFixtures();
      appendCapture(CAPTURES_DIR, { kind: "fixtures", data: fixtures });
      return json(fixtures);
    },
  );

  server.registerTool(
    "get_live_odds",
    {
      description: "Get the current odds snapshot for a match from the TxLINE feed.",
      inputSchema: { match_id: z.string().describe("TxLINE match identifier") },
    },
    async ({ match_id }) => {
      const payloads = await client.getOddsSnapshot(match_id);
      appendCapture(CAPTURES_DIR, { kind: "odds", matchId: match_id, data: payloads });
      // Feed the detector's history with the normalized full-time 1X2 point, if present.
      const snapshot = toOddsSnapshot(payloads);
      if (snapshot) {
        const history = oddsHistory.get(match_id) ?? [];
        history.push(snapshot);
        oddsHistory.set(match_id, history);
      }
      return json(payloads);
    },
  );

  server.registerTool(
    "get_match_events",
    {
      description: "Get score/match events (goals, kickoff, full time) for a match.",
      inputSchema: { match_id: z.string().describe("TxLINE match identifier") },
    },
    async ({ match_id }) => {
      const events = await client.getScores(match_id);
      appendCapture(CAPTURES_DIR, { kind: "scores", matchId: match_id, data: events });
      return json(events);
    },
  );

  server.registerTool(
    "detect_odds_shift",
    {
      description:
        "Run the deterministic odds-shift detector over the accumulated odds history for a match. " +
        "Fires when any outcome's overround-normalized implied probability moves by at least " +
        "threshold_pct percentage points within the window. Feed integrity is checked first.",
      inputSchema: {
        match_id: z.string().describe("TxLINE match identifier"),
        window_seconds: z.number().default(300).describe("Lookback window in seconds"),
        threshold_pct: z.number().default(5).describe("Trigger threshold in percentage points"),
      },
    },
    async ({ match_id, window_seconds, threshold_pct }) => {
      const history = oddsHistory.get(match_id) ?? [];
      const integrity = checkFeedIntegrity(history, Date.now());
      if (!integrity.ok) {
        return json({ fired: false, reason: `feed integrity check failed: ${integrity.reason}` });
      }
      const result = detectShift(history, window_seconds, threshold_pct);
      return json(result);
    },
  );

  return server;
}
