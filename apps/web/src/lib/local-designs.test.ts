import { createEmptyDoc } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { templateDoc } from "../../tests/support/docs";
import { docFromTemplate, moveToAccount, newLocalDesign, type LocalDesign, type LocalDesignStore } from "./local-designs";

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
