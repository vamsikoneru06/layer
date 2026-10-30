import { createEmptyDoc, type Doc } from "@vash/schema";
import { describe, expect, it, vi } from "vitest";
import { forgetUnusedPhotos, uploadDocPhotos, withUploadedPhotos, type LocalPhoto, type LocalPhotoStore } from "./local-photos";

function memoryStore(photos: LocalPhoto[] = []): LocalPhotoStore & { all: Map<string, LocalPhoto> } {
  const all = new Map(photos.map((p) => [p.id, p]));
  return {
    all,
    list: async () => [...all.values()],
    get: async (id) => all.get(id),
    put: async (p) => void all.set(p.id, p),
    delete: async (id) => void all.delete(id),
  };
}

const photo = (id: string, extra: Partial<LocalPhoto> = {}): LocalPhoto => ({
  id,
  blob: new Blob(["x"], { type: "image/jpeg" }),
  mime: "image/jpeg",
  width: 40,
  height: 30,
  createdAt: "2026-10-09T00:00:00Z",
  ...extra,
});

/** A design with one frame showing `assetId`. */
function docWith(assetId: string): Doc {
  const doc = createEmptyDoc({ id: "d", kind: "design", title: "T", format: "custom", size: { width: 100, height: 100 } });
  doc.assets[assetId] = { id: assetId, kind: "photo", mime: "image/jpeg", width: 40, height: 30 };
  doc.nodes.f = { id: "f", type: "frame", content: { assetId, offsetX: 0, offsetY: 0, scale: 1 } } as never;
  doc.root = ["f"];
  return doc;
}

/** A lock manager that runs each request after the previous one with the same name has finished. */
function fakeLocks() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request: <T>(name: string, cb: () => Promise<T>): Promise<T> => {
      const run = (tails.get(name) ?? Promise.resolve()).then(cb);
      tails.set(name, run.catch(() => undefined));
      return run;
    },
  };
}

describe("uploadDocPhotos", () => {
  it("uploads the design's device photos and points the design at the uploaded copies", async () => {
    const store = memoryStore([photo("local-1")]);
    const upload = vi.fn(async () => ({ id: "server-1" }));
    const doc = await uploadDocPhotos(docWith("local-1"), store, upload);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(Object.keys(doc.assets)).toEqual(["server-1"]);
    expect((doc.nodes.f as { content: { assetId: string } }).content.assetId).toBe("server-1");
    // The upload is remembered, so a retry after a lost response doesn't upload again.
    expect(store.all.get("local-1")?.uploadedAs).toBe("server-1");
    await uploadDocPhotos(docWith("local-1"), store, upload);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("passes the device photo's id as the upload id, so a retry after a lost response asks for the same asset", async () => {
    const store = memoryStore([photo("local-1")]);
    const upload = vi.fn(async (_file: File, id?: string) => ({ id: id ?? "no-id" }));
    upload.mockRejectedValueOnce(new Error("response lost"));
    await expect(uploadDocPhotos(docWith("local-1"), store, upload)).rejects.toThrow("response lost");
    await uploadDocPhotos(docWith("local-1"), store, upload);
    expect(upload.mock.calls.map((call) => call[1])).toEqual(["local-1", "local-1"]);
    expect(store.all.get("local-1")?.uploadedAs).toBe("local-1");
  });

  it("leaves account and sample photos alone", async () => {
    const store = memoryStore();
    const upload = vi.fn();
    const doc = docWith("already-on-server");
    expect(await uploadDocPhotos(doc, store, upload)).toBe(doc);
    expect(upload).not.toHaveBeenCalled();
  });

  it("stops at the first failed upload, keeping the photo on the device", async () => {
    const store = memoryStore([photo("local-1")]);
    await expect(uploadDocPhotos(docWith("local-1"), store, async () => Promise.reject(new Error("over quota")))).rejects.toThrow("over quota");
    expect(store.all.get("local-1")?.uploadedAs).toBeUndefined();
  });
});

describe("forgetUnusedPhotos", () => {
  it("removes uploaded photos no design on the device still uses", async () => {
    const store = memoryStore([photo("moved", { uploadedAs: "s1" }), photo("still-used", { uploadedAs: "s2" }), photo("not-uploaded")]);
    await forgetUnusedPhotos(store, [docWith("still-used")]);
    expect([...store.all.keys()].sort()).toEqual(["not-uploaded", "still-used"]);
  });
});

describe("withUploadedPhotos", () => {
  it("creates the design with its device photos uploaded, and a retry doesn't upload again", async () => {
    const store = memoryStore([photo("local-1")]);
    const upload = vi.fn(async () => ({ id: "server-1" }));
    const created: Doc[] = [];
    let first = true;
    const create = vi.fn(async (doc: Doc) => {
      created.push(doc);
      if (first) {
        first = false;
        throw new Error("network");
      }
      return { id: "acct-1" };
    });
    const wrapped = withUploadedPhotos(create, upload, store);
    await expect(wrapped(docWith("local-1"))).rejects.toThrow("network");
    expect(await wrapped(docWith("local-1"))).toEqual({ id: "acct-1" });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(Object.keys(created[1]!.assets)).toEqual(["server-1"]);
  });
});

describe("uploads running at once", () => {
  it("share one upload for the same photo", async () => {
    const store = memoryStore([photo("local-1")]);
    let finish!: (v: { id: string }) => void;
    const upload = vi.fn(() => new Promise<{ id: string }>((r) => (finish = r)));
    const a = uploadDocPhotos(docWith("local-1"), store, upload);
    const b = uploadDocPhotos(docWith("local-1"), store, upload);
    await new Promise((r) => setTimeout(r, 0));
    finish({ id: "server-1" });
    const [da, db] = await Promise.all([a, b]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(Object.keys(da.assets)).toEqual(["server-1"]);
    expect(Object.keys(db.assets)).toEqual(["server-1"]);
  });

  it("share one upload across two tabs through the Web Locks API", async () => {
    // Tab B is a fresh module instance, so it has its own in-tab map; only the lock can stop it uploading again.
    // Both tabs read the same records, like two tabs on one IndexedDB.
    const backing = memoryStore([photo("local-1")]);
    const tabA: LocalPhotoStore = backing;
    const tabB: LocalPhotoStore = { ...backing };
    const upload = vi.fn(() => new Promise<{ id: string }>((r) => setTimeout(() => r({ id: "server-1" }), 10)));
    vi.stubGlobal("navigator", { locks: fakeLocks() });
    try {
      vi.resetModules();
      const second = await import("./local-photos");
      const [a, b] = await Promise.all([uploadDocPhotos(docWith("local-1"), tabA, upload), second.uploadDocPhotos(docWith("local-1"), tabB, upload)]);
      expect(upload).toHaveBeenCalledTimes(1);
      expect(Object.keys(a.assets)).toEqual(["server-1"]);
      expect(Object.keys(b.assets)).toEqual(["server-1"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
