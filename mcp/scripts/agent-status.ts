/**
 * Print the on-chain state of the registered agent — the verifiable track
 * record as anyone would read it from the chain.
 *
 *   npx tsx scripts/agent-status.ts
 */
import { ProvennChainClient } from "../src/chain/provenn.js";

async function main() {
  const chain = await ProvennChainClient.connect();
  const agent = await chain.fetchAgent();
  if (!agent) {
    console.log("No agent registered for this wallet.");
    return;
  }
  console.log(JSON.stringify(agent, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

void main();
