import { describe, expect, it } from "vitest";
import { foldEvents, type LogEvent } from "./types";

describe("foldEvents", () => {
  it("turns an integrity_skip event into a gated watch card", () => {
    const events: LogEvent[] = [
      {
        at: "2026-07-15T10:00:00.000Z",
        event: "integrity_skip",
        matchId: "18213979",
        reason: "glitch heuristic: home implied prob jumped 30.0pp in one tick at index 1",
      } as unknown as LogEvent,
    ];

    const { watch } = foldEvents(events);

    expect(watch).toHaveLength(1);
    expect(watch[0].integrityOk).toBe(false);
    expect(watch[0].reason).toBe(
      "glitch heuristic: home implied prob jumped 30.0pp in one tick at index 1",
    );
  });
});
