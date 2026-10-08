import { randomUUID } from "node:crypto";
import { LIMITS, parseDoc, type Doc } from "@vash/schema";
import { findUnusableAssets } from "../assets/repository";
import { isForeignKeyViolation, isUniqueViolation } from "../db/errors";
import type { Db } from "../db/types";
import { folderExists } from "../folders/repository";
import { conflict, notFound, unprocessable } from "../http/problem";
import { insertWithinQuota } from "../quotas";
import { truncate } from "../text";
import * as repo from "./repository";

export interface ServiceContext {
  db: Db;
  now: () => Date;
}

async function checkDoc(db: Db, ownerId: string, raw: unknown, designId: string): Promise<Doc> {
  const parsed = parseDoc(raw);
  if (!parsed.ok) throw unprocessable("The document is invalid.", { issues: parsed.issues.slice(0, 50) });
  const doc: Doc = { ...parsed.doc, id: designId };
  const unusable = await findUnusableAssets(db, ownerId, Object.values(doc.assets));
  if (unusable.length > 0) throw unprocessable("The document references assets you can't use.", { assetIds: unusable });
  return doc;
}

const folderMissing = () => unprocessable("folderId does not refer to one of your folders.");

async function assertFolder(db: Db, ownerId: string, folderId: string | null | undefined): Promise<void> {
  if (folderId && !(await folderExists(db, ownerId, folderId))) throw folderMissing();
}

/** The folder can be deleted between assertFolder and the write; the FK then fails and it's still the caller's 422. */
async function writingFolder<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (err) {
    if (isForeignKeyViolation(err)) throw folderMissing();
    throw err;
  }
}

/**
 * A client may choose the id (designs made on a device before signing in): then a repeat of the same create
 * returns the stored design (`created: false`), so an interrupted move to the account is safe to retry.
 */
export async function createDesign(
  ctx: ServiceContext,
  ownerId: string,
  input: { id?: string; title?: string; folderId?: string | null; doc: unknown },
): Promise<{ design: repo.DesignRow; created: boolean }> {
  const id = input.id ?? randomUUID();
  if (input.id) {
    const existing = await repo.getDesign(ctx.db, ownerId, id);
    if (existing) return { design: existing, created: false };
  }
  const doc = await checkDoc(ctx.db, ownerId, input.doc, id);
  if (input.title !== undefined) doc.meta = { ...doc.meta, title: input.title };
  await assertFolder(ctx.db, ownerId, input.folderId);
  const now = ctx.now();
  try {
    const design = await writingFolder(
      insertWithinQuota(ctx.db, ownerId, "designs", (tx) =>
        repo.insertDesign(tx, { id, ownerId, folderId: input.folderId ?? null, title: doc.meta.title, doc, createdAt: now, updatedAt: now }),
      ),
    );
    return { design, created: true };
  } catch (err) {
    if (!input.id || !isUniqueViolation(err)) throw err;
    // A concurrent repeat won the race, or the id belongs to someone else (never say whose).
    const existing = await repo.getDesign(ctx.db, ownerId, id);
    if (existing) return { design: existing, created: false };
    throw conflict("That design id is already taken. Try again with a new one.");
  }
}

/**
 * Autosave, the busiest write: the compare-and-swap update is the only query on success (plus the asset check
 * when the document has assets). Whether the design exists is looked up only on a failure, so someone else's
 * design still answers 404 before any 422 or 409.
 */
export async function saveDesignDoc(ctx: ServiceContext, ownerId: string, id: string, input: { doc: unknown; version: number }): Promise<repo.DesignRow> {
  let doc: Doc;
  try {
    doc = await checkDoc(ctx.db, ownerId, input.doc, id);
  } catch (err) {
    if ((await repo.getDesignVersion(ctx.db, ownerId, id)) === undefined) throw notFound();
    throw err;
  }
  const saved = await repo.updateDesignDoc(ctx.db, ownerId, id, input.version, doc, ctx.now());
  if (saved) return { ...saved, doc };
  const current = await repo.getDesignVersion(ctx.db, ownerId, id);
  if (current === undefined) throw notFound();
  throw conflict("This design changed since you loaded it.", { currentVersion: current });
}

export async function updateDesignMeta(
  ctx: ServiceContext,
  ownerId: string,
  id: string,
  patch: { title?: string; folderId?: string | null },
): Promise<repo.DesignRow> {
  if ((await repo.getDesignVersion(ctx.db, ownerId, id)) === undefined) throw notFound();
  await assertFolder(ctx.db, ownerId, patch.folderId);
  const row = await writingFolder(repo.updateDesignMeta(ctx.db, ownerId, id, patch, ctx.now()));
  if (!row) throw notFound();
  return row;
}

export async function duplicateDesign(ctx: ServiceContext, ownerId: string, id: string): Promise<repo.DesignRow> {
  const source = await repo.getDesign(ctx.db, ownerId, id);
  if (!source) throw notFound();
  const copyId = randomUUID();
  const title = truncate(`Copy of ${source.title}`, LIMITS.titleChars);
  const now = ctx.now();
  return insertWithinQuota(ctx.db, ownerId, "designs", (tx) =>
    repo.insertDesign(tx, {
      id: copyId,
      ownerId,
      folderId: source.folderId,
      title,
      doc: { ...source.doc, id: copyId, meta: { ...source.doc.meta, title } },
      sourceTemplateId: source.sourceTemplateId,
      sourceTemplateVersion: source.sourceTemplateVersion,
      thumbnailAssetId: source.thumbnailAssetId,
      createdAt: now,
      updatedAt: now,
    }),
  );
}
