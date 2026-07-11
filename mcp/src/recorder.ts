import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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

function dateFileName(date: string): string {
  return `${date}.jsonl`;
}

/** Append one payload as a JSON line to today's capture file in `dir`. */
export function appendCapture(dir: string, payload: unknown): void {
  mkdirSync(dir, { recursive: true });
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const line: CaptureLine = { capturedAt: now.toISOString(), payload };
  appendFileSync(join(dir, dateFileName(date)), JSON.stringify(line) + "\n", "utf8");
}

/** Read back all capture lines for a given YYYY-MM-DD date. */
export function readCaptures(dir: string, date: string): CaptureLine[] {
  const path = join(dir, dateFileName(date));
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as CaptureLine);
}
