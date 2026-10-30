import { createEmptyDoc, LIMITS, parseDoc, type Doc, type FormatKey } from "@vash/schema";

/**
 * Designs made without an account live in this browser's IndexedDB until the person signs in, then move to
 * their account (`moveToAccount`). The store is an interface so the moving logic runs under the node tests.
 */

export interface LocalDesign {
  id: string;
  doc: Doc;
  /** Counts saves, like the server's version, so the editor's autosaver works unchanged. */
  version: number;
  updatedAt: string;
}

export interface LocalDesignStore {
  list(): Promise<LocalDesign[]>;
  get(id: string): Promise<LocalDesign | undefined>;
  put(design: LocalDesign): Promise<void>;
  delete(id: string): Promise<void>;
  /** Deletes the design only if it still has this version. Returns false, and keeps it, if it changed. */
  deleteIfVersion(id: string, version: number): Promise<boolean>;
}

export function newLocalDesign(doc: Doc, now = new Date()): LocalDesign {
  return { id: doc.id, doc, version: 1, updatedAt: now.toISOString() };
}

export function blankDoc(format: FormatKey, size?: { width: number; height: number }): Doc {
  return createEmptyDoc({ id: crypto.randomUUID(), kind: "design", title: "Untitled design", format, size });
}

/** A template's current document as a new design, as the server's "use template" makes it. Null if it doesn't validate. */
export function docFromTemplate(templateDoc: unknown): Doc | null {
  const parsed = parseDoc(templateDoc, { kind: "template" });
  return parsed.ok ? { ...parsed.doc, id: crypto.randomUUID(), kind: "design" } : null;
}

/** "Make a copy" for a design kept in this browser: a new local design titled like the server's copies. */
export async function copyLocalDesign(store: LocalDesignStore, id: string, now = new Date()): Promise<LocalDesign> {
  const source = await store.get(id);
  if (!source) throw new Error("This design is no longer in this browser.");
  let title = `Copy of ${source.doc.meta.title}`.slice(0, LIMITS.titleChars);
  // Never end on half of a surrogate pair.
  if (/[\ud800-\udbff]$/.test(title)) title = title.slice(0, -1);
  const copy = newLocalDesign({ ...source.doc, id: crypto.randomUUID(), meta: { ...source.doc.meta, title } }, now);
  await store.put(copy);
  return copy;
}

/** Newest first, like the account's design list. */
export const byUpdated = (a: LocalDesign, b: LocalDesign) => b.updatedAt.localeCompare(a.updatedAt);

type Saved = { id: string; version: number; doc: Doc };
type Create = (doc: Doc, id?: string) => Promise<Saved>;
type Save = (id: string, doc: Doc, version: number) => Promise<number>;

const statusOf = (err: unknown) => (err as { status?: number }).status;

/** Compares two documents by content. Keys are sorted first, since the server may store them in another order. */
function sameDoc(a: Doc, b: Doc): boolean {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

/**
 * Moves one local design into the signed-in account and returns its id there. It keeps its id, so a move
 * cut short (a closed tab, a lost response) can run again without making a copy. The account gets the
 * device's document before the local copy is removed. If the account already has the id with another
 * document (an earlier move kept the device copy, and the account copy has moved on since), the device's
 * document is saved over it at the version the account returned. The local copy is deleted only if it still
 * has the version that was sent: an edit made since (another tab, the autosaver) keeps it, and `kept` is true.
 * If the id is taken (status 409), or the account copy changes before that save (also 409), the design is
 * created under a new id instead.
 */
export async function moveDesign(store: LocalDesignStore, design: LocalDesign, create: Create, save: Save): Promise<{ id: string; kept: boolean }> {
  let saved: Saved;
  try {
    saved = await create(design.doc, design.id);
  } catch (err) {
    if (statusOf(err) !== 409) throw err;
    saved = await create(design.doc);
  }
  // The device's document under the account's id (the same id, unless the account made a new one).
  const doc = { ...design.doc, id: saved.id };
  if (!sameDoc(saved.doc, doc)) {
    try {
      await save(saved.id, doc, saved.version);
    } catch (err) {
      if (statusOf(err) !== 409) throw err;
      saved = await create(design.doc);
    }
  }
  const deleted = await store.deleteIfVersion(design.id, design.version);
  return { id: saved.id, kept: !deleted };
}

/** Moves every local design, oldest first; any the account refuses stay on the device. */
export async function moveToAccount(store: LocalDesignStore, create: Create, save: Save): Promise<{ moved: { from: string; to: string }[]; failed: number }> {
  const moved: { from: string; to: string }[] = [];
  let failed = 0;
  for (const design of (await store.list()).sort(byUpdated).reverse()) {
    try {
      moved.push({ from: design.id, to: (await moveDesign(store, design, create, save)).id });
    } catch {
      failed++;
    }
  }
  return { moved, failed };
}

const DB_NAME = "vash";
const STORE = "designs";
/** Guest photos (lib/local-photos.ts) share the database, so one upgrade adds both stores. */
export const PHOTO_STORE = "photos";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      for (const name of [STORE, PHOTO_STORE]) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const unavailable = () => new Error("Couldn’t save on this device. Your browser may be blocking site storage, for example in a private window.");

/** Runs one request against a store, opening and closing the database around it. */
export async function runStore<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open().catch(() => Promise.reject(unavailable()));
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = op(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? unavailable());
      tx.onabort = () => reject(tx.error ?? unavailable());
    });
  } finally {
    db.close();
  }
}

const run = <T,>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>) => runStore(STORE, mode, op);

/** The read and the delete share one transaction, so no edit can land between them. */
async function removeIfVersion(id: string, version: number): Promise<boolean> {
  const db = await open().catch(() => Promise.reject(unavailable()));
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const s = tx.objectStore(STORE);
      const get = s.get(id);
      let deleted = false;
      get.onsuccess = () => {
        if ((get.result as LocalDesign | undefined)?.version !== version) return;
        s.delete(id);
        deleted = true;
      };
      tx.oncomplete = () => resolve(deleted);
      tx.onerror = () => reject(tx.error ?? unavailable());
      tx.onabort = () => reject(tx.error ?? unavailable());
    });
  } finally {
    db.close();
  }
}

/** The browser's store. Every call opens and closes the database, so no connection blocks a later upgrade. */
export const localDesigns: LocalDesignStore = {
  list: () => run("readonly", (s) => s.getAll() as IDBRequest<LocalDesign[]>),
  get: (id) => run("readonly", (s) => s.get(id) as IDBRequest<LocalDesign | undefined>),
  put: async (design) => {
    await run("readwrite", (s) => s.put(design));
  },
  delete: async (id) => {
    await run("readwrite", (s) => s.delete(id));
  },
  deleteIfVersion: removeIfVersion,
};

