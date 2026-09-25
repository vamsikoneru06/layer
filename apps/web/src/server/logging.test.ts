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
});
