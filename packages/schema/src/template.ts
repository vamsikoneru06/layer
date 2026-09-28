import { LIMITS } from "./constants";
import type { AssetId, Doc, FrameNode, ValidationIssue } from "./types";

/** Asset IDs actually referenced by nodes (unreferenced entries in `assets` are ignored). */
export function referencedAssetIds(doc: Doc): Set<AssetId> {
  const ids = new Set<AssetId>();
  for (const node of Object.values(doc.nodes)) {
    if (node.type === "frame" && node.content) ids.add(node.content.assetId);
    if (node.type === "sticker") ids.add(node.assetId);
  }
  return ids;
}

/**
 * Rules a document must meet to be saved or published as a template
 * (on top of the schema validator). Mirrors the Author Mode pre-save checklist.
 */
export function lintTemplate(doc: Doc): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodes = Object.values(doc.nodes);

  if (nodes.length > LIMITS.templateNodes) {
    issues.push({ path: "nodes", message: `templates may have at most ${LIMITS.templateNodes} layers` });
  }
  const hasPlaceholder = nodes.some((n) => n.type === "frame" && n.placeholder);
  const hasEditableText = nodes.some((n) => n.type === "text" && n.lock !== "locked");
  if (!hasPlaceholder && !hasEditableText) {
    issues.push({ path: "nodes", message: "template needs at least one placeholder frame or editable text layer" });
  }
  for (const node of nodes) {
    if (node.type === "frame" && !node.placeholder && node.content === null) {
      issues.push({ path: `nodes.${node.id}`, message: "empty frame must be marked as a placeholder" });
    }
  }
  return issues;
}

export interface PiiFinding {
  nodeId: string;
  kind: "email" | "phone";
  /** Masked excerpt safe to show in UI and logs. */
  masked: string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// International or Indian mobile numbers: optional +CC, 10+ digits with common separators.
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\d[\s-]?){9,13}\d/g;

function mask(value: string): string {
  const visible = 2;
  const chars = [...value];
  return chars
    .map((ch, i) => (i < visible || i >= chars.length - visible || !/[A-Za-z0-9]/.test(ch) ? ch : "•"))
    .join("");
}

/** Scan text layers for contact details the author may not want to publish. */
export function scanForPii(doc: Doc): PiiFinding[] {
  const findings: PiiFinding[] = [];
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== "text") continue;
    for (const match of node.content.matchAll(EMAIL)) {
      findings.push({ nodeId: node.id, kind: "email", masked: mask(match[0]) });
    }
    const withoutEmails = node.content.replace(EMAIL, " ");
    for (const match of withoutEmails.matchAll(PHONE)) {
      const digits = match[0].replace(/\D/g, "");
      if (digits.length >= 10) findings.push({ nodeId: node.id, kind: "phone", masked: mask(match[0].trim()) });
    }
  }
  return findings;
}

/**
 * Publish privacy scrub: every frame whose photo is not in `keep` becomes an empty placeholder,
 * and assets no longer referenced are dropped from the document.
 * Returns a new document; the input is not modified.
 */
export function scrubForPublish(doc: Doc, keep: ReadonlySet<AssetId>): Doc {
  const nodes: Doc["nodes"] = {};
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (node.type === "frame" && node.content && !keep.has(node.content.assetId)) {
      const scrubbed: FrameNode = { ...node, content: null, placeholder: true };
      nodes[id] = scrubbed;
    } else {
      nodes[id] = node;
    }
  }
  const next: Doc = { ...doc, nodes, assets: {} };
  const used = referencedAssetIds(next);
  for (const [id, asset] of Object.entries(doc.assets)) {
    if (used.has(id)) next.assets[id] = asset;
  }
  return next;
}

/** Returns a copy of `doc` with asset ids renamed (old → new) in frames, stickers and the assets map. */
export function replaceAssetIds(doc: Doc, ids: ReadonlyMap<AssetId, AssetId>): Doc {
  const rename = (id: AssetId) => ids.get(id) ?? id;
  const nodes: Doc["nodes"] = {};
  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    if (node.type === "frame" && node.content) nodes[nodeId] = { ...node, content: { ...node.content, assetId: rename(node.content.assetId) } };
    else if (node.type === "sticker") nodes[nodeId] = { ...node, assetId: rename(node.assetId) };
    else nodes[nodeId] = node;
  }
  const assets: Doc["assets"] = {};
  for (const [id, ref] of Object.entries(doc.assets)) assets[rename(id)] = { ...ref, id: rename(id) };
  return { ...doc, nodes, assets };
}
