import { z } from "zod";
import type { Deps } from "../deps";
import { readJson } from "../http/body";
import { endpoint } from "../http/endpoint";
import { parseId } from "../http/ids";
import { HttpError } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import type { ObjectStorage } from "../storage/types";
import * as service from "./service";

const UploadBody = z
  .object({
    kind: z.enum(["photo", "thumbnail"]),
    mime: z.enum(service.UPLOAD_MIMES),
    bytes: z.number().int().min(1).max(service.UPLOAD_LIMITS.maxBytes),
  })
  .strict();

const Dimension = z.number().int().min(1).max(service.UPLOAD_LIMITS.maxDimension);
const CompleteBody = z.object({ width: Dimension, height: Dimension }).strict();

export function assetHandlers(deps: Deps, storage: ObjectStorage | null) {
  const ctx = (): service.AssetContext => {
    if (!storage) throw new HttpError(503, "Service Unavailable", "Photo storage isn't configured on this server.");
    return { db: deps.db, now: deps.now, storage };
  };
  return {
    requestUpload: endpoint(deps, { auth: "user", rateLimit: { name: "uploadUrl", rule: RATE_LIMITS.uploadUrl, by: "user" } }, async ({ req, user }) => {
      const c = ctx();
      const body = await readJson(req, UploadBody);
      const { asset, upload } = await service.requestUpload(c, user.id, body);
      return Response.json({ asset: service.toAssetJson(asset), upload }, { status: 201 });
    }),

    complete: endpoint(deps, { auth: "user" }, async ({ req, user, params }) => {
      const c = ctx();
      const id = parseId(params.id);
      const body = await readJson(req, CompleteBody);
      return Response.json(service.toAssetJson(await service.completeUpload(c, user.id, id, body)));
    }),
  };
}
