import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createProvennMcpServer } from "./mcpServer.js";

/**
 * Remote MCP Connector entrypoint (Streamable HTTP, stateless).
 *
 * Claude's "Add custom connector" UI expects a plain HTTPS URL, not a local
 * subprocess — this is that URL's handler, mounted onto the existing
 * dashboard API service (see scripts/serve-api.ts) so no separate deploy is
 * needed. Same tools and detector as the stdio server (index.ts); only the
 * transport differs.
 *
 * Stateless because a Protocol/Server instance can only ever be connected to
 * one transport: each request gets a throwaway McpServer + transport pair,
 * while the odds-history Map and TxLineClient underneath (module-level in
 * mcpServer.ts) persist across requests, so a client's get_live_odds calls
 * still accumulate history for a later detect_odds_shift call.
 */
export async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const server = createProvennMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
