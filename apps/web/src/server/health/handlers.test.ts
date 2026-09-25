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
});
