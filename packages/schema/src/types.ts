/**
 * The VASH document format (schemaVersion 2).
 *
 * Rules that keep the format safe and predictable:
 * - Every key is required; "absent" is expressed as `null`. The optional keys (`shadow`, `alt`, `stroke.dash`,
 *   and the text `outline`, `highlight`, `list`) may be omitted; designs and templates written before they existed stay valid.
 * - Layers live in a flat `nodes` map; `root` and `group.children` hold IDs.
 * - Assets are referenced by ID only. The document never contains a URL.
 * - Filters are parameters; pixels are never baked into the document.
 */

export type NodeId = string;
export type AssetId = string;

/** `#RRGGBB` or `#RRGGBBAA`. */
export type Color = string;

export type FormatKey = "ig-post" | "ig-story" | "yt-thumbnail" | "poster" | "invitation" | "custom";

export type Lock = "free" | "content-only" | "locked";

export type Fill =
  | { type: "solid"; color: Color }
  | { type: "linear"; angle: number; stops: Array<{ offset: number; color: Color }> };

export interface Transform {
  x: number;
  y: number;
  /** Degrees, clockwise, about the node centre. */
  rotation: number;
  scaleX: number;
  scaleY: number;
}

export interface Shadow {
  color: Color;
  /** Blur radius in document pixels. */
  blur: number;
  offsetX: number;
  offsetY: number;
}

interface BaseNode {
  id: NodeId;
  name: string;
  transform: Transform;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  lock: Lock;
  /** Optional: omit or `null` for no shadow. */
  shadow?: Shadow | null;
  /** Optional: alt text for the node, plain text without control characters. */
  alt?: string;
}

/** Path data is in unit-box coordinates (0..1 on both axes) and scaled to the node size. */
export type FrameShape =
  | { kind: "rect"; cornerRadius: number }
  | { kind: "ellipse" }
  | { kind: "path"; d: string };

export interface Filters {
  preset: string | null;
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  tint: number;
  highlights: number;
  shadows: number;
  vignette: number;
  grain: number;
  blur: number;
  sharpen: number;
}

export interface FrameContent {
  assetId: AssetId;
  /** Offset of the photo centre from the frame centre, in frame pixels. */
  offsetX: number;
  offsetY: number;
  /** Photo scale relative to "cover" fit (1 = exactly covers the frame). */
  scale: number;
}

export interface FrameNode extends BaseNode {
  type: "frame";
  shape: FrameShape;
  content: FrameContent | null;
  filters: Filters;
  placeholder: boolean;
}

export interface FontSpec {
  family: string;
  weight: number;
  style: "normal" | "italic";
}

export type TextList = "none" | "bullet" | "number";

export interface TextNode extends BaseNode {
  type: "text";
  content: string;
  font: FontSpec;
  size: number;
  color: Color;
  align: "left" | "center" | "right" | "justify";
  lineHeight: number;
  letterSpacing: number;
  fit: "none" | "shrink";
  maxChars: number | null;
  /** Optional: text outline, or omit / `null` for none. */
  outline?: { color: Color; width: number } | null;
  /** Optional: background highlight behind the text, or omit / `null` for none. */
  highlight?: { color: Color } | null;
  /** Optional: list markers per line. Omit for none. */
  list?: TextList;
}

export type ShapeGeometry =
  | { kind: "rect"; cornerRadius: number }
  | { kind: "ellipse" }
  | { kind: "polygon"; sides: number }
  | { kind: "path"; d: string };

export type StrokeDash = "solid" | "dashed" | "dotted";

export interface ShapeNode extends BaseNode {
  type: "shape";
  geometry: ShapeGeometry;
  fill: Fill | null;
  /** `dash` is optional and defaults to solid. */
  stroke: { color: Color; width: number; dash?: StrokeDash } | null;
}

export interface StickerNode extends BaseNode {
  type: "sticker";
  assetId: AssetId;
}

export interface GroupNode extends BaseNode {
  type: "group";
  children: NodeId[];
}

export type Node = FrameNode | TextNode | ShapeNode | StickerNode | GroupNode;
export type NodeType = Node["type"];

export type AssetMime = "image/jpeg" | "image/png" | "image/webp" | "image/svg+xml";

export interface AssetRef {
  id: AssetId;
  kind: "photo" | "sticker";
  mime: AssetMime;
  width: number;
  height: number;
}

export interface DocMeta {
  title: string;
  category: string | null;
  tags: string[];
  format: FormatKey;
}

export interface Doc {
  schemaVersion: 2;
  id: string;
  kind: "design" | "template";
  meta: DocMeta;
  artboard: { width: number; height: number; background: Fill };
  root: NodeId[];
  nodes: Record<NodeId, Node>;
  assets: Record<AssetId, AssetRef>;
}

export interface ValidationIssue {
  /** Dotted path to the offending value, e.g. `nodes.abc.transform.rotation`. */
  path: string;
  message: string;
}

export type ValidationResult = { ok: true; doc: Doc } | { ok: false; issues: ValidationIssue[] };
