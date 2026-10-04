import { lintTemplate, parseDoc, scanForPii, scrubForPublish, type Doc, type PiiFinding, type ValidationIssue } from "@vash/schema";
import { and, eq, inArray } from "drizzle-orm";
import { findUnusableAssets, type AssetRow } from "../assets/repository";
import { assets } from "../db/schema";
import type { Db } from "../db/types";
import { getDesign, type DesignRow } from "../designs/repository";
import { isUuid } from "../http/ids";
import { notFound, unprocessable } from "../http/problem";

/** Not in the spec: bounds how much public storage one publish can add. */
export const PUBLISH_LIMITS = { keptPhotos: 10, descriptionChars: 1000 } as const;

export interface DraftPhoto {
  assetId: string;
  nodeIds: string[];
  /** The author's own ready photo, so it may be kept. */
  yours: boolean;
}

export interface DraftAnalysis {
  design: DesignRow;
  /** The draft after the privacy scrub: every photo not kept is now an empty placeholder. */
  doc: Doc;
  photos: DraftPhoto[];
  /** The author's own ready photos that stay in the template. */
  kept: AssetRow[];
  issues: ValidationIssue[];
  pii: PiiFinding[];
}

/** Spec §8.4 steps 2 and 5, without writing anything: what publishing this draft would produce. */
export async function analyzeDraft(db: Db, authorId: string, designId: string, keep: readonly string[]): Promise<DraftAnalysis> {
  const design = await getDesign(db, authorId, designId);
  if (!design) throw notFound();
  if (design.doc.kind !== "template") throw unprocessable("Only template drafts can be published. Open this design in Author Mode first.");

  const frames = new Map<string, string[]>();
  for (const node of Object.values(design.doc.nodes)) {
    if (node.type === "frame" && node.content) frames.set(node.content.assetId, [...(frames.get(node.content.assetId) ?? []), node.id]);
  }
  const candidates = [...frames.keys()].filter(isUuid);
  const own =
    candidates.length === 0
      ? []
      : await db
          .select()
          .from(assets)
          .where(and(inArray(assets.id, candidates), eq(assets.ownerId, authorId), eq(assets.status, "ready"), eq(assets.kind, "photo")));
  const ownById = new Map(own.map((a) => [a.id, a]));

  const kept: AssetRow[] = [];
  for (const id of new Set(keep)) {
    if (!frames.has(id)) throw unprocessable("You can only keep photos that are in this template.", { assetId: id });
    const asset = ownById.get(id);
    if (!asset) throw unprocessable("You can only keep your own photos.", { assetId: id });
    kept.push(asset);
  }

  const doc = scrubForPublish(design.doc, new Set(kept.map((a) => a.id)));
  const parsed = parseDoc(doc, { kind: "template" });
  const issues = parsed.ok ? lintTemplate(parsed.doc) : parsed.issues.slice(0, 50);
  for (const id of await findUnusableAssets(db, authorId, Object.values(doc.assets))) {
    issues.push({ path: `assets.${id}`, message: "can't be published: it isn't yours, a system asset or public" });
  }
  return {
    design,
    doc,
    photos: [...frames].map(([assetId, nodeIds]) => ({ assetId, nodeIds, yours: ownById.has(assetId) })),
    kept,
    issues,
    pii: scanForPii(doc),
  };
}
