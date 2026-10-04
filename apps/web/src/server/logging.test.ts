import { describe, expect, it } from "vitest";
import { createLogger } from "./logging";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger((line) => lines.push(JSON.parse(line)), () => new Date("2026-09-25T00:00:00.000Z"));
  return { logger, lines };
}

describe("createLogger", () => {
  it("writes one JSON object per event", () => {
    const { logger, lines } = capture();
    logger.info("request", { requestId: "r1", status: 200 });
    expect(lines).toEqual([{ time: "2026-09-25T00:00:00.000Z", level: "info", event: "request", requestId: "r1", status: 200 }]);
  });

  it("redacts sensitive keys at any depth", () => {
    const { logger, lines } = capture();
    logger.warn("x", { email: "a@b.c", nested: { sessionToken: "t", apiKey: "k", ok: 1 }, headers: { authorization: "Bearer z", cookie: "c" } });
    expect(lines[0]).toMatchObject({
      email: "[redacted]",
      nested: { sessionToken: "[redacted]", apiKey: "[redacted]", ok: 1 },
      headers: { authorization: "[redacted]", cookie: "[redacted]" },
    });
  });

  it("redacts sensitive keys nested deeper than the traversal limit", () => {
    const { logger, lines } = capture();
    logger.info("x", { a: { b: { c: { d: { e: { f: { token: "deep-secret" } } } } } } });
    expect(JSON.stringify(lines[0])).not.toContain("deep-secret");
  });

  it("logs errors without SQL parameters", () => {
    const { logger, lines } = capture();
    const err = new Error('Failed query: select * from "user" where email = $1\nparams: riya@example.test');
    err.name = "DrizzleQueryError";
    (err as Error & { cause?: unknown }).cause = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    logger.error("request.failed", { err });
    const text = JSON.stringify(lines[0]);
    expect(text).not.toContain("riya@example.test");
    expect(text).toContain("connection refused");
  });

  it("hands errors to the error reporter with the event name and request id, unredacted for its own scrubber", () => {
    const reported: unknown[][] = [];
    const lines: string[] = [];
    const logger = createLogger((l) => lines.push(l), undefined, (err, tags) => reported.push([err, tags]));
    const err = new Error("boom");
    logger.error("request.failed", { requestId: "r9", err });
    logger.error("no.error.field", { requestId: "r10" });
    logger.warn("warn.only", { err });
    expect(reported).toEqual([[err, { event: "request.failed", requestId: "r9" }]]);
    expect(lines).toHaveLength(3);
  });

  it("keeps logging when the error reporter throws", () => {
    const lines: string[] = [];
    const logger = createLogger((l) => lines.push(l), undefined, () => {
      throw new Error("reporter down");
    });
    expect(() => logger.error("x", { err: new Error("boom") })).not.toThrow();
    expect(lines).toHaveLength(1);
  });
});
