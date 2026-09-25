import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { emptyDoc } from "../../../tests/support/docs";
import { createUser } from "../../../tests/support/factories";
import type * as FoldersRepository from "../folders/repository";
import { createDesign, updateDesignMeta } from "./service";

// Simulates the folder being deleted between the ownership check and the write.
vi.mock("../folders/repository", async (original) => ({
  ...(await original<typeof FoldersRepository>()),
  folderExists: vi.fn(async () => true),
}));

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

describe("folder deleted mid-request", () => {
  it("answers 422, not 500, on create and on move", async () => {
    const alice = await createUser(t.db);
    const ctx = { db: t.db, now: () => new Date() };
    const vanished = randomUUID();
    await expect(createDesign(ctx, alice.id, { doc: emptyDoc(), folderId: vanished })).rejects.toMatchObject({ status: 422 });

    const design = await createDesign(ctx, alice.id, { doc: emptyDoc() });
    await expect(updateDesignMeta(ctx, alice.id, design.id, { folderId: vanished })).rejects.toMatchObject({ status: 422 });
  });
});
