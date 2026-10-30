import { createEmptyDoc, LIMITS, type Doc } from "@vash/schema";
import { describe, expect, it, vi } from "vitest";
import { templateDoc } from "../../tests/support/docs";
import { copyLocalDesign, docFromTemplate, moveDesign, moveToAccount, newLocalDesign, type LocalDesign, type LocalDesignStore } from "./local-designs";

function memoryStore(designs: LocalDesign[] = []): LocalDesignStore & { ids(): string[] } {
  const rows = new Map(designs.map((d) => [d.id, d]));
  return {
    list: async () => [...rows.values()],
    get: async (id) => rows.get(id),
    put: async (d) => void rows.set(d.id, d),
    delete: async (id) => void rows.delete(id),
    deleteIfVersion: async (id, version) => {
      if (rows.get(id)?.version !== version) return false;
      rows.delete(id);
      return true;
    },
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

/** A save the test does not expect: the fake account answers with the document it was sent, so none is made. */
const noSave = async (): Promise<number> => {
  throw new Error("save was not expected");
};

/**
 * A fake account that answers like the server: a create with an id it has returns that copy, and a save must
 * name the version the account holds.
 */
function fakeAccount(rows = new Map<string, { doc: Doc; version: number }>()) {
  const create = vi.fn(async (doc: Doc, id?: string) => {
    if (id && rows.has(id)) return { id, ...rows.get(id)! };
    const made = id ?? crypto.randomUUID();
    rows.set(made, { doc: { ...doc, id: made }, version: 1 });
    return { id: made, version: 1, doc: { ...doc, id: made } };
  });
  const save = vi.fn(async (id: string, doc: Doc, version: number) => {
    const row = rows.get(id);
    if (!row) throw Object.assign(new Error("not found"), { status: 404 });
    if (row.version !== version) throw Object.assign(new Error("changed"), { status: 409 });
    rows.set(id, { doc, version: version + 1 });
    return version + 1;
  });
  return { rows, create, save };
}

/** An account copy of the design that has moved on: another title, two saves in. */
const olderCopy = (a: LocalDesign) => ({ doc: { ...a.doc, meta: { ...a.doc.meta, title: "Older" } }, version: 2 });

describe("moveToAccount", () => {
  it("creates each design under its own id, oldest first, and only then deletes the local copy", async () => {
    const older = design("Older", "2026-10-01T00:00:00Z");
    const newer = design("Newer", "2026-10-02T00:00:00Z");
    const store = memoryStore([newer, older]);
    const calls: { title: string; id?: string; storedThen: string[] }[] = [];
    const result = await moveToAccount(
      store,
      async (doc, id) => {
        calls.push({ title: doc.meta.title, id, storedThen: store.ids() });
        return { id: id!, version: 1, doc };
      },
      noSave,
    );
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
    const result = await moveToAccount(
      store,
      async (doc, id) => {
        if (doc.meta.title === "A") throw Object.assign(new Error("quota"), { status: 422 });
        return { id: id!, version: 1, doc };
      },
      noSave,
    );
    expect(result.failed).toBe(1);
    expect(store.ids()).toEqual([a.id]);
  });

  it("falls back to a new id when its id is taken", async () => {
    const a = design("A", "2026-10-01T00:00:00Z");
    const store = memoryStore([a]);
    const result = await moveToAccount(
      store,
      async (doc, id) => {
        if (id) throw Object.assign(new Error("taken"), { status: 409 });
        return { id: "server-id", version: 1, doc: { ...doc, id: "server-id" } };
      },
      noSave,
    );
    expect(result.moved).toEqual([{ from: a.id, to: "server-id" }]);
    expect(store.ids()).toEqual([]);
  });
});

describe("moveDesign", () => {
  it("moves a design the account has not seen without saving it again, and deletes the device copy", async () => {
    const a = design("A", "2026-10-01T00:00:00Z");
    const store = memoryStore([a]);
    const account = fakeAccount();
    expect(await moveDesign(store, a, account.create, account.save)).toEqual({ id: a.id, kept: false });
    expect(account.save).not.toHaveBeenCalled();
    expect(account.rows.get(a.id)).toEqual({ doc: a.doc, version: 1 });
    expect(store.ids()).toEqual([]);
  });

  it("saves the device's document over an older account copy, at the version the account returned", async () => {
    const a = design("A", "2026-10-01T00:00:00Z");
    const store = memoryStore([a]);
    const account = fakeAccount(new Map([[a.id, olderCopy(a)]]));
    expect(await moveDesign(store, a, account.create, account.save)).toEqual({ id: a.id, kept: false });
    expect(account.save).toHaveBeenCalledWith(a.id, a.doc, 2);
    expect(account.rows.get(a.id)).toEqual({ doc: a.doc, version: 3 });
    expect(store.ids()).toEqual([]);
  });

  it("makes a new account design when the account copy changed before the save, and keeps the device's document there", async () => {
    const a = design("A", "2026-10-01T00:00:00Z");
    const store = memoryStore([a]);
    const account = fakeAccount(new Map([[a.id, olderCopy(a)]]));
    account.save.mockRejectedValueOnce(Object.assign(new Error("changed"), { status: 409 }));
    const moved = await moveDesign(store, a, account.create, account.save);
    expect(account.create).toHaveBeenCalledTimes(2);
    expect(account.create).toHaveBeenLastCalledWith(a.doc);
    expect(moved.id).not.toBe(a.id);
    expect(account.rows.get(moved.id)?.doc.meta.title).toBe("A");
    expect(account.rows.get(a.id)).toEqual(olderCopy(a));
    // The device copy is unchanged, so it goes like in any other move; the new account design holds its document.
    expect(moved.kept).toBe(false);
    expect(store.ids()).toEqual([]);
  });

  it("keeps the device copy, and says so, when it was edited during the move", async () => {
    const a = design("A", "2026-10-01T00:00:00Z");
    const store = { ...memoryStore([a]), deleteIfVersion: async () => false };
    const account = fakeAccount();
    expect(await moveDesign(store, a, account.create, account.save)).toEqual({ id: a.id, kept: true });
    expect(account.rows.get(a.id)?.doc).toEqual(a.doc);
  });

  it("keeps the device copy when it was edited while the account copy was being created", async () => {
    const a = design("A", "2026-10-01T00:00:00Z");
    const store = memoryStore([a]);
    const moved = await moveDesign(
      store,
      a,
      async (doc, id) => {
        await store.put({ ...a, version: a.version + 1, updatedAt: "2026-10-03T00:00:00.000Z" });
        return { id: id!, version: 1, doc };
      },
      noSave,
    );
    expect(moved).toEqual({ id: a.id, kept: true });
    expect(await store.get(a.id)).toMatchObject({ version: 2 });
  });

  it("keeps the device copy and reports the error when the account fails for another reason", async () => {
    const a = design("A", "2026-10-01T00:00:00Z");
    const store = memoryStore([a]);
    const account = fakeAccount(new Map([[a.id, olderCopy(a)]]));
    account.save.mockRejectedValueOnce(Object.assign(new Error("Server is down"), { status: 500 }));
    await expect(moveDesign(store, a, account.create, account.save)).rejects.toThrow("Server is down");
    expect(store.ids()).toEqual([a.id]);
  });
});
