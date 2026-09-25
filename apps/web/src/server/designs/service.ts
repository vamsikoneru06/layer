import { randomUUID } from "node:crypto";
import { LIMITS, parseDoc, type Doc } from "@layer/schema";
import { findUnusableAssets } from "../assets/repository";
import type { Db } from "../db/types";
import { folderExists } from "../folders/repository";
import { conflict, notFound, unprocessable } from "../http/problem";
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

async function assertFolder(db: Db, ownerId: string, folderId: string | null | undefined): Promise<void> {
  if (folderId && !(await folderExists(db, ownerId, folderId))) {
    throw unprocessable("folderId does not refer to one of your folders.");
  }
}

export async function createDesign(
  ctx: ServiceContext,
  ownerId: string,
  input: { title?: string; folderId?: string | null; doc: unknown },
): Promise<repo.DesignRow> {
  const id = randomUUID();
  const doc = await checkDoc(ctx.db, ownerId, input.doc, id);
  if (input.title !== undefined) doc.meta = { ...doc.meta, title: input.title };
  await assertFolder(ctx.db, ownerId, input.folderId);
  const now = ctx.now();
  return repo.insertDesign(ctx.db, { id, ownerId, folderId: input.folderId ?? null, title: doc.meta.title, doc, createdAt: now, updatedAt: now });
}

export async function saveDesignDoc(ctx: ServiceContext, ownerId: string, id: string, input: { doc: unknown; version: number }): Promise<repo.DesignRow> {
  if ((await repo.getDesignVersion(ctx.db, ownerId, id)) === undefined) throw notFound();
  const doc = await checkDoc(ctx.db, ownerId, input.doc, id);
  const saved = await repo.updateDesignDoc(ctx.db, ownerId, id, input.version, doc, ctx.now());
  if (saved) return saved;
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
  const row = await repo.updateDesignMeta(ctx.db, ownerId, id, patch, ctx.now());
  if (!row) throw notFound();
  return row;
}

export async function duplicateDesign(ctx: ServiceContext, ownerId: string, id: string): Promise<repo.DesignRow> {
  const source = await repo.getDesign(ctx.db, ownerId, id);
  if (!source) throw notFound();
  const copyId = randomUUID();
  const title = `Copy of ${source.title}`.slice(0, LIMITS.titleChars);
  const now = ctx.now();
  return repo.insertDesign(ctx.db, {
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
  });
}
