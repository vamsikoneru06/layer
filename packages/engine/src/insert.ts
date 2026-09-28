import { defaultFilters, LIMITS, type Doc, type FrameNode, type Node, type ShapeNode, type TextNode } from "@vash/schema";
import type { EditorCore } from "./editor-core";

export type InsertKind = "heading" | "subheading" | "body" | "rect" | "rounded" | "ellipse" | "triangle" | "frame" | "frame-circle";

/** A random node id in the schema's id alphabet. */
export function newNodeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return `n${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("")}`;
}

/** Relative luminance of the background's first colour (0 black, 1 white), to pick legible text. */
function backgroundLuma(doc: Doc): number {
  const bg = doc.artboard.background;
  const hex = bg.type === "solid" ? bg.color : (bg.stops[0]?.color ?? "#FFFFFF");
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const TEXT: Record<"heading" | "subheading" | "body", { name: string; content: string; size: number; family: string; weight: number }> = {
  heading: { name: "Heading", content: "Add a heading", size: 0.08, family: "Poppins", weight: 700 },
  subheading: { name: "Subheading", content: "Add a subheading", size: 0.05, family: "Poppins", weight: 500 },
  body: { name: "Text", content: "Add a little text", size: 0.032, family: "Inter", weight: 400 },
};

/**
 * A new layer of `kind`, centred on the artboard and sized relative to it, so it looks the same on a
 * story, a post or a poster. Text is dark on light backgrounds and white on dark ones.
 */
export function createNode(kind: InsertKind, doc: Doc, id: string = newNodeId()): Node {
  const { width: W, height: H } = doc.artboard;
  const side = Math.min(W, H);
  const base = { id, transform: { x: W / 2, y: H / 2, rotation: 0, scaleX: 1, scaleY: 1 }, opacity: 1, visible: true, lock: "free" as const };

  if (kind === "heading" || kind === "subheading" || kind === "body") {
    const t = TEXT[kind];
    const size = Math.round(W * t.size);
    const text: TextNode = {
      ...base,
      type: "text",
      name: t.name,
      width: Math.round(W * 0.8),
      height: Math.round(size * 1.2 * 1.25),
      content: t.content,
      font: { family: t.family, weight: t.weight, style: "normal" },
      size,
      color: backgroundLuma(doc) > 0.5 ? "#1D1D1F" : "#FFFFFF",
      align: "center",
      lineHeight: 1.2,
      letterSpacing: 0,
      fit: "none",
      maxChars: null,
    };
    return text;
  }

  if (kind === "frame" || kind === "frame-circle") {
    const s = Math.round(side * 0.5);
    const frame: FrameNode = {
      ...base,
      type: "frame",
      name: kind === "frame" ? "Photo frame" : "Round photo frame",
      width: s,
      height: s,
      shape: kind === "frame" ? { kind: "rect", cornerRadius: 0 } : { kind: "ellipse" },
      content: null,
      filters: defaultFilters(),
      placeholder: true,
    };
    return frame;
  }

  const s = Math.round(side * 0.3);
  const geometry: ShapeNode["geometry"] =
    kind === "rect"
      ? { kind: "rect", cornerRadius: 0 }
      : kind === "rounded"
        ? { kind: "rect", cornerRadius: Math.round(s * 0.15) }
        : kind === "ellipse"
          ? { kind: "ellipse" }
          : { kind: "polygon", sides: 3 };
  const names = { rect: "Rectangle", rounded: "Rounded rectangle", ellipse: "Circle", triangle: "Triangle" } as const;
  const shape: ShapeNode = { ...base, type: "shape", name: names[kind], width: s, height: s, geometry, fill: { type: "solid", color: "#C7C7CC" }, stroke: null };
  return shape;
}

/**
 * Adds a new layer on top and selects it (text starts in typing mode). Returns false, with a notice,
 * when the design already has as many layers as it may.
 */
export function insertLayer(core: EditorCore, kind: InsertKind): boolean {
  const doc = core.doc;
  const max = doc.kind === "template" ? LIMITS.templateNodes : LIMITS.designNodes;
  if (Object.keys(doc.nodes).length >= max) {
    core.setChrome({ notice: `A design can have up to ${max} layers.` });
    return false;
  }
  const node = createNode(kind, doc);
  if (!core.dispatch({ type: "insert", nodes: [node], parent: null, index: doc.root.length })) return false;
  core.select([node.id]);
  if (node.type === "text") core.startTextEdit(node.id);
  return true;
}
