import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { testDeps } from "../../../tests/support/deps";
import { call } from "../../../tests/support/invoke";
import type { Db } from "../db/types";
import { healthHandlers } from "./handlers";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

describe("GET /api/health", () => {
  it("reports ok when the database answers", async () => {
    const res = await call(healthHandlers(testDeps(t.db)).get);
    expect(res).toMatchObject({ status: 200, body: { status: "ok" } });
  });
  it("reports 503 without detail when the database is down", async () => {
    const broken = { execute: () => Promise.reject(new Error("ECONNREFUSED 10.0.0.5:5432")) } as unknown as Db;
    const res = await call(healthHandlers(testDeps(broken)).get);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable" });
  });
  it("probes the database at most once per 5 seconds however often it is called", async () => {
    let probes = 0;
    const counting = { execute: async () => void probes++ } as unknown as Db;
    let now = Date.parse("2026-09-26T10:00:00.000Z");
    const h = healthHandlers(testDeps(counting, { now: () => new Date(now) }));
    for (let i = 0; i < 50; i++) expect((await call(h.get)).status).toBe(200);
    expect(probes).toBe(1);
    now += 5_001;
    await call(h.get);
    expect(probes).toBe(2);
  });
});
