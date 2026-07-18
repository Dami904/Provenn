import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createProvennMcpServer } from "./mcpServer.js";

/**
 * Local MCP entrypoint: the Provenn tools over stdio, for MCP clients that
 * launch a subprocess (Claude Desktop's local server config, Claude Code
 * `mcp add`, etc). For a hosted Connector reachable over HTTP, see
 * mcpHttp.ts / scripts/serve-api.ts instead — same tools, same detector.
 */
const server = createProvennMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("provenn-mcp: listening on stdio");
