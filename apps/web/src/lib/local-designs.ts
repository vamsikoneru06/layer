import { createEmptyDoc, parseDoc, type Doc, type FormatKey } from "@vash/schema";

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

/** Newest first, like the account's design list. */
export const byUpdated = (a: LocalDesign, b: LocalDesign) => b.updatedAt.localeCompare(a.updatedAt);

type Create = (doc: Doc, id?: string) => Promise<{ id: string }>;

/**
 * Moves one local design into the signed-in account and returns its id there. It keeps its id, so a move
 * cut short (a closed tab, a lost response) can run again without making a copy; the local copy is deleted
 * only once the account has it. If the id is taken (status 409), the design is created under a new one.
 */
export async function moveDesign(store: LocalDesignStore, design: LocalDesign, create: Create): Promise<string> {
  let saved: { id: string };
  try {
    saved = await create(design.doc, design.id);
  } catch (err) {
    if ((err as { status?: number }).status !== 409) throw err;
    saved = await create(design.doc);
  }
  await store.delete(design.id);
  return saved.id;
}

/** Moves every local design, oldest first; any the account refuses stay on the device. */
export async function moveToAccount(store: LocalDesignStore, create: Create): Promise<{ moved: { from: string; to: string }[]; failed: number }> {
  const moved: { from: string; to: string }[] = [];
  let failed = 0;
  for (const design of (await store.list()).sort(byUpdated).reverse()) {
    try {
      moved.push({ from: design.id, to: await moveDesign(store, design, create) });
    } catch {
      failed++;
    }
  }
  return { moved, failed };
}

const DB_NAME = "vash";
const STORE = "designs";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const unavailable = () => new Error("Couldn’t save on this device. Your browser may be blocking site storage, for example in a private window.");

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open().catch(() => Promise.reject(unavailable()));
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
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
};

