import type { Doc, NodeId, TextNode } from "@vash/schema";
import { multiply, translation, type Mat } from "./math";
import { worldMatrix } from "./scene";
import { layoutText, type Measure } from "./text";
import type { Viewport } from "./viewport";

/** Where and how to draw the on-canvas text box for a layer being edited, in CSS px. */
export interface TextEditBox {
  node: TextNode;
  /** CSS `matrix()` for an element whose top-left is at the canvas origin (transform-origin 0 0). */
  matrix: Mat;
  /** Element size in the layer's own units; taller than the layer when the text overflows it. */
  width: number;
  height: number;
  /** Space above the first line, so the text sits vertically centred like on the canvas. */
  paddingTop: number;
  /** The laid-out size (after shrink-to-fit) and line height in px. */
  fontSize: number;
  lineHeight: number;
}

export function textEditBox(doc: Doc, id: NodeId, v: Viewport, measure: Measure): TextEditBox | null {
  const node = doc.nodes[id];
  if (node?.type !== "text") return null;
  const layout = layoutText(node, measure);
  // The renderer centres the lines on the layer's centre, so an overflowing block grows both ways.
  const height = Math.max(node.height, layout.height);
  const view: Mat = [v.zoom, 0, 0, v.zoom, v.panX, v.panY];
  const matrix = multiply(view, multiply(worldMatrix(doc, id), translation(-node.width / 2, -height / 2)));
  return { node, matrix, width: node.width, height, paddingTop: (height - layout.height) / 2, fontSize: layout.size, lineHeight: layout.lineHeight };
}
