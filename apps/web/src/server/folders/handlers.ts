import { LIMITS } from "@layer/schema";
import { z } from "zod";
import type { Deps } from "../deps";
import { readJson, readQuery } from "../http/body";
import { decodeCursor, pageQuery, toPage } from "../http/cursor";
import { endpoint } from "../http/endpoint";
import { parseId } from "../http/ids";
import { notFound } from "../http/problem";
import { insertWithinQuota } from "../quotas";
import { createFolder, deleteFolder, listFolders, renameFolder, type FolderRow } from "./repository";

const FolderBody = z.object({ name: z.string().trim().min(1).max(LIMITS.nameChars) }).strict();

const toJson = (f: FolderRow) => ({ id: f.id, name: f.name, createdAt: f.createdAt.toISOString(), updatedAt: f.updatedAt.toISOString() });

export function folderHandlers(deps: Deps) {
  return {
    list: endpoint(deps, { auth: "user" }, async ({ req, user }) => {
      const q = readQuery(req, pageQuery);
      const rows = await listFolders(deps.db, user.id, { cursor: q.cursor ? decodeCursor(q.cursor) : undefined, limit: q.limit });
      return Response.json(toPage(rows, q.limit, (r) => ({ at: r.createdAt.toISOString(), id: r.id }), toJson));
    }),

    create: endpoint(deps, { auth: "user" }, async ({ req, user }) => {
      const body = await readJson(req, FolderBody);
      const row = await insertWithinQuota(deps.db, user.id, "folders", (tx) => createFolder(tx, user.id, body.name, deps.now()));
      return Response.json(toJson(row), { status: 201 });
    }),

    rename: endpoint(deps, { auth: "user" }, async ({ req, user, params }) => {
      const id = parseId(params.id);
      const body = await readJson(req, FolderBody);
      const row = await renameFolder(deps.db, user.id, id, body.name, deps.now());
      if (!row) throw notFound();
      return Response.json(toJson(row));
    }),

    remove: endpoint(deps, { auth: "user" }, async ({ user, params }) => {
      if (!(await deleteFolder(deps.db, user.id, parseId(params.id)))) throw notFound();
      return new Response(null, { status: 204 });
    }),
  };
}
