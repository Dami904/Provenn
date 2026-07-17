import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Dead-simple JSONL capture recorder. One line per captured payload, one file
 * per UTC day: captures/YYYY-MM-DD.jsonl. Used to record live TxLINE feed
 * responses for deterministic replay (see replay.ts).
 */

export interface CaptureLine {
  capturedAt: string; // ISO 8601
  payload: unknown;
}

/** Append one payload as a JSON line to today's capture file in `dir`. */
export function appendCapture(dir: string, payload: unknown): void {
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const line: CaptureLine = { capturedAt: now.toISOString(), payload };
  appendFileSync(join(dir, `${date}.jsonl`), JSON.stringify(line) + "\n", "utf8");
}
