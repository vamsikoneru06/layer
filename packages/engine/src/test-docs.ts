import { createEmptyDoc, defaultFilters, type Doc, type FrameNode, type GroupNode, type ShapeNode, type TextNode, type Transform } from "@vash/schema";

/** Small builders for engine tests. Not exported from the package. */

const base = (id: string, t: Partial<Transform>, width: number, height: number) => ({
  id,
  name: id,
  transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, ...t },
  width,
  height,
  opacity: 1,
  visible: true,
  lock: "free" as const,
});

export const rect = (id: string, t: Partial<Transform>, width = 100, height = 100): ShapeNode => ({
  ...base(id, t, width, height),
  type: "shape",
  geometry: { kind: "rect", cornerRadius: 0 },
  fill: { type: "solid", color: "#FF0000" },
  stroke: null,
});

export const ellipse = (id: string, t: Partial<Transform>, width = 100, height = 100): ShapeNode => ({
  ...rect(id, t, width, height),
  geometry: { kind: "ellipse" },
});

export const frame = (id: string, t: Partial<Transform>, width = 100, height = 100): FrameNode => ({
  ...base(id, t, width, height),
  type: "frame",
  shape: { kind: "rect", cornerRadius: 0 },
  content: null,
  filters: defaultFilters(),
  placeholder: true,
});

export const text = (id: string, t: Partial<Transform>, content = "Hello", width = 300, height = 60): TextNode => ({
  ...base(id, t, width, height),
  type: "text",
  content,
  font: { family: "Inter", weight: 400, style: "normal" },
  size: 32,
  color: "#000000",
  align: "left",
  lineHeight: 1.2,
  letterSpacing: 0,
  fit: "none",
  maxChars: null,
});

export const group = (id: string, t: Partial<Transform>, children: string[], width = 200, height = 200): GroupNode => ({
  ...base(id, t, width, height),
  type: "group",
  children,
});

/** A 1000×1000 design with the given top-level nodes (children of groups go in `extra`). */
export function docWith(top: Doc["nodes"][string][], extra: Doc["nodes"][string][] = []): Doc {
  const doc = createEmptyDoc({ id: "d1", kind: "design", title: "Test", format: "custom", size: { width: 1000, height: 1000 } });
  for (const n of [...top, ...extra]) doc.nodes[n.id] = n;
  doc.root = top.map((n) => n.id);
  return doc;
}
