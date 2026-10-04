import { createEmptyDoc, defaultFilters, type Doc } from "@vash/schema";

export function emptyDoc(title = "Birthday card"): Doc {
  return createEmptyDoc({ id: "draft", kind: "design", title, format: "ig-post" });
}

export function docWithPhoto(assetId: string): Doc {
  const doc = emptyDoc();
  doc.nodes.photo1 = {
    id: "photo1",
    type: "frame",
    name: "Photo",
    transform: { x: 540, y: 540, rotation: 0, scaleX: 1, scaleY: 1 },
    width: 800,
    height: 600,
    opacity: 1,
    visible: true,
    lock: "free",
    shape: { kind: "rect", cornerRadius: 0 },
    content: { assetId, offsetX: 0, offsetY: 0, scale: 1 },
    filters: defaultFilters(),
    placeholder: false,
  };
  doc.root.push("photo1");
  doc.assets[assetId] = { id: assetId, kind: "photo", mime: "image/jpeg", width: 1200, height: 900 };
  return doc;
}

/** A valid, lint-clean template: an editable heading and one frame (a placeholder unless it holds `photoAssetId`). */
export function templateDoc(opts: { title?: string; heading?: string; photoAssetId?: string } = {}): Doc {
  const doc = createEmptyDoc({ id: "draft", kind: "template", title: opts.title ?? "Birthday post", format: "ig-post" });
  doc.nodes.heading = {
    id: "heading",
    type: "text",
    name: "Heading",
    transform: { x: 540, y: 900, rotation: 0, scaleX: 1, scaleY: 1 },
    width: 900,
    height: 120,
    opacity: 1,
    visible: true,
    lock: "content-only",
    content: opts.heading ?? "Happy birthday!",
    font: { family: "Poppins", weight: 700, style: "normal" },
    size: 72,
    color: "#16161A",
    align: "center",
    lineHeight: 1.2,
    letterSpacing: 0,
    fit: "shrink",
    maxChars: 200,
  };
  doc.nodes.photo1 = {
    id: "photo1",
    type: "frame",
    name: "Photo",
    transform: { x: 540, y: 400, rotation: 0, scaleX: 1, scaleY: 1 },
    width: 800,
    height: 600,
    opacity: 1,
    visible: true,
    lock: "content-only",
    shape: { kind: "rect", cornerRadius: 0 },
    content: opts.photoAssetId ? { assetId: opts.photoAssetId, offsetX: 0, offsetY: 0, scale: 1 } : null,
    filters: defaultFilters(),
    placeholder: !opts.photoAssetId,
  };
  doc.root.push("photo1", "heading");
  if (opts.photoAssetId) doc.assets[opts.photoAssetId] = { id: opts.photoAssetId, kind: "photo", mime: "image/jpeg", width: 1200, height: 900 };
  return doc;
}
