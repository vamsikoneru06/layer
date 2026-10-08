import { createEmptyDoc, LIMITS } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { templateDoc } from "../../tests/support/docs";
import { copyLocalDesign, docFromTemplate, moveToAccount, newLocalDesign, type LocalDesign, type LocalDesignStore } from "./local-designs";

function memoryStore(designs: LocalDesign[] = []): LocalDesignStore & { ids(): string[] } {
  const rows = new Map(designs.map((d) => [d.id, d]));
  return {
    list: async () => [...rows.values()],
    get: async (id) => rows.get(id),
    put: async (d) => void rows.set(d.id, d),
    delete: async (id) => void rows.delete(id),
    ids: () => [...rows.keys()],
  };
}

const design = (title: string, at: string) =>
  newLocalDesign(createEmptyDoc({ id: crypto.randomUUID(), kind: "design", title, format: "ig-post" }), new Date(at));

describe("docFromTemplate", () => {
  it("makes a design with a new id from a template document", () => {
    const tpl = templateDoc({ title: "Party" });
    const doc = docFromTemplate(tpl);
    expect(doc).toMatchObject({ kind: "design", meta: { title: "Party" } });
    expect(doc!.id).not.toBe(tpl.id);
  });

  it("refuses anything that isn't a valid template", () => {
    expect(docFromTemplate({ nope: true })).toBeNull();
    expect(docFromTemplate(createEmptyDoc({ id: crypto.randomUUID(), kind: "design", title: "x", format: "ig-post" }))).toBeNull();
  });
});

describe("copyLocalDesign", () => {
  it("stores a copy under a new id with the same content and a 'Copy of' title", async () => {
    const source = design("Poster", "2026-10-01T00:00:00Z");
    const store = memoryStore([source]);
    const copy = await copyLocalDesign(store, source.id, new Date("2026-10-07T00:00:00Z"));
    expect(copy.id).not.toBe(source.id);
    expect(copy.doc.id).toBe(copy.id);
    expect(copy.doc.meta.title).toBe("Copy of Poster");
    expect(copy.doc.artboard).toEqual(source.doc.artboard);
    expect(copy).toMatchObject({ version: 1, updatedAt: "2026-10-07T00:00:00.000Z" });
    expect(await store.get(copy.id)).toEqual(copy);
    expect(await store.get(source.id)).toEqual(source);
  });

  it("keeps the title within the limit without splitting a character", async () => {
    const long = design("a".repeat(LIMITS.titleChars - 9) + "\u{1F600}", "2026-10-01T00:00:00Z");
    const copy = await copyLocalDesign(memoryStore([long]), long.id);
    expect(copy.doc.meta.title.length).toBeLessThanOrEqual(LIMITS.titleChars);
    expect(copy.doc.meta.title).not.toMatch(/[\ud800-\udbff]$/);
  });

  it("says so when the design is gone", async () => {
    await expect(copyLocalDesign(memoryStore(), "missing")).rejects.toThrow("no longer in this browser");
  });
});

describe("moveToAccount", () => {
  it("creates each design under its own id, oldest first, and only then deletes the local copy", async () => {
    const older = design("Older", "2026-10-01T00:00:00Z");
    const newer = design("Newer", "2026-10-02T00:00:00Z");
    const store = memoryStore([newer, older]);
    const calls: { title: string; id?: string; storedThen: string[] }[] = [];
    const result = await moveToAccount(store, async (doc, id) => {
      calls.push({ title: doc.meta.title, id, storedThen: store.ids() });
      return { id: id! };
    });
    expect(calls.map((c) => [c.title, c.id])).toEqual([
      ["Older", older.id],
      ["Newer", newer.id],
    ]);
    expect(calls[0]!.storedThen).toContain(older.id);
    expect(result).toEqual({ moved: [{ from: older.id, to: older.id }, { from: newer.id, to: newer.id }], failed: 0 });
    expect(store.ids()).toEqual([]);
  });

  it("keeps a design on the device when the account refuses it, and moves the rest", async () => {
    const a = design("A", "2026-10-01T00:00:00Z");
    const b = design("B", "2026-10-02T00:00:00Z");
    const store = memoryStore([a, b]);
    const result = await moveToAccount(store, async (doc, id) => {
      if (doc.meta.title === "A") throw Object.assign(new Error("quota"), { status: 422 });
      return { id: id! };
    });
    expect(result.failed).toBe(1);
    expect(store.ids()).toEqual([a.id]);
  });

  it("falls back to a new id when its id is taken", async () => {
    const a = design("A", "2026-10-01T00:00:00Z");
    const store = memoryStore([a]);
    const result = await moveToAccount(store, async (_doc, id) => {
      if (id) throw Object.assign(new Error("taken"), { status: 409 });
      return { id: "server-id" };
    });
    expect(result.moved).toEqual([{ from: a.id, to: "server-id" }]);
    expect(store.ids()).toEqual([]);
  });
});
