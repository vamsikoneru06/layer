import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../../tests/support/db";
import { createTemplate } from "../../../tests/support/factories";
import { publicTemplate } from "./public";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

describe("publicTemplate", () => {
  it("returns a published template with its current document, for server-rendered pages", async () => {
    const tpl = await createTemplate(t.db, { title: "Weekly specials" });
    const found = await publicTemplate(t.db, tpl.id.toUpperCase());
    expect(found).toMatchObject({ id: tpl.id, title: "Weekly specials", doc: { id: tpl.id, kind: "template" } });
  });

  it("returns null for hidden, unknown and malformed ids, so nothing private renders on a public page", async () => {
    const hidden = await createTemplate(t.db, { status: "hidden" });
    expect(await publicTemplate(t.db, hidden.id)).toBeNull();
    expect(await publicTemplate(t.db, randomUUID())).toBeNull();
    expect(await publicTemplate(t.db, "not-an-id")).toBeNull();
  });
});
