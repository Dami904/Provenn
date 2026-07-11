/**
 * Render entrypoint: runs the dashboard API (binds $PORT) and the agent
 * runner in one web service, restarting either child if it crashes.
 *
 *   npx tsx scripts/start-service.ts
 *
 * Required env: TXLINE_ENV, TXLINE_JWT, TXLINE_API_TOKEN, WALLET_KEYPAIR.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const RESTART_DELAY_MS = 5000;

function supervise(name: string, script: string): void {
  const child = spawn("npx", ["tsx", resolve(scriptsDir, script)], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    console.error(`[supervisor] ${name} exited (code=${code} signal=${signal}); restarting in ${RESTART_DELAY_MS}ms`);
    setTimeout(() => supervise(name, script), RESTART_DELAY_MS);
  });
}

supervise("serve-api", "serve-api.ts");
supervise("run-agent", "run-agent.ts");
