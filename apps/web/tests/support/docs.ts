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
