import { LIMITS, type GroupNode, type ShapeNode } from "@vash/schema";
import type { EditorCore } from "./editor-core";
import { newNodeId } from "./insert";

/** A grid of equal rectangles, centred on the artboard. `gap` 0 with a stroke makes a table. */
export interface GridOptions {
  rows: number;
  cols: number;
  /** Side of each square cell, in artboard pixels. */
  cellSize: number;
  /** Space between neighbouring cells, in artboard pixels. */
  gap: number;
  /** `#RRGGBB` or `#RRGGBBAA`, or null for no fill. */
  fill: string | null;
  stroke: { color: string; width: number } | null;
}

const GRID_MAX = 12;
const COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** The first reason `o` cannot be placed, or null when it can. */
function problemWith(o: GridOptions): string | null {
  if (!Number.isInteger(o.rows) || o.rows < 1 || o.rows > GRID_MAX) return `A grid has 1 to ${GRID_MAX} rows.`;
  if (!Number.isInteger(o.cols) || o.cols < 1 || o.cols > GRID_MAX) return `A grid has 1 to ${GRID_MAX} columns.`;
  if (!Number.isFinite(o.cellSize) || o.cellSize <= 0 || o.cellSize > LIMITS.artboardMax) return `Cells must be 1 to ${LIMITS.artboardMax} px.`;
  if (!Number.isFinite(o.gap) || o.gap < 0 || o.gap > LIMITS.artboardMax) return `The gap must be 0 to ${LIMITS.artboardMax} px.`;
  const width = o.cols * o.cellSize + (o.cols - 1) * o.gap;
  const height = o.rows * o.cellSize + (o.rows - 1) * o.gap;
  if (width > LIMITS.coordinate || height > LIMITS.coordinate) return "That grid is too large.";
  if (o.fill !== null && !COLOR.test(o.fill)) return "The fill colour is not valid.";
  if (o.stroke !== null) {
    if (!COLOR.test(o.stroke.color)) return "The stroke colour is not valid.";
    if (!Number.isFinite(o.stroke.width) || o.stroke.width < 0 || o.stroke.width > LIMITS.strokeWidthMax) {
      return `The stroke must be 0 to ${LIMITS.strokeWidthMax} px.`;
    }
  }
  return null;
}

/**
 * Adds one group of rows times cols square shapes, centred on the artboard, selected, as one undo step.
 * The group only translates, so each cell's position is relative to the group's centre. Returns false,
 * with a notice, for sizes the schema would refuse or when the design has no room for every cell.
 */
export function insertGrid(core: EditorCore, o: GridOptions): boolean {
  const problem = problemWith(o);
  if (problem) {
    core.setChrome({ notice: problem });
    return false;
  }
  const doc = core.doc;
  // Same cap as a single layer (see addOnTop in insert.ts): templates have their own, smaller limit.
  const max = doc.kind === "template" ? LIMITS.templateNodes : LIMITS.designNodes;
  const count = o.rows * o.cols;
  if (Object.keys(doc.nodes).length + count + 1 > max) {
    core.setChrome({ notice: `A design can have up to ${max} layers.` });
    return false;
  }

  const width = o.cols * o.cellSize + (o.cols - 1) * o.gap;
  const height = o.rows * o.cellSize + (o.rows - 1) * o.gap;
  const step = o.cellSize + o.gap;
  const children: ShapeNode[] = [];
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.cols; c++) {
      children.push({
        id: newNodeId(),
        type: "shape",
        name: "Cell",
        transform: { x: -width / 2 + o.cellSize / 2 + c * step, y: -height / 2 + o.cellSize / 2 + r * step, rotation: 0, scaleX: 1, scaleY: 1 },
        width: o.cellSize,
        height: o.cellSize,
        opacity: 1,
        visible: true,
        lock: "free",
        geometry: { kind: "rect", cornerRadius: 0 },
        fill: o.fill === null ? null : { type: "solid", color: o.fill },
        stroke: o.stroke === null ? null : { color: o.stroke.color, width: o.stroke.width },
      });
    }
  }

  const group: GroupNode = {
    id: newNodeId(),
    type: "group",
    name: o.stroke !== null && o.gap === 0 ? "Table" : "Grid",
    transform: { x: doc.artboard.width / 2, y: doc.artboard.height / 2, rotation: 0, scaleX: 1, scaleY: 1 },
    width,
    height,
    opacity: 1,
    visible: true,
    lock: "free",
    children: children.map((child) => child.id),
  };
  if (!core.dispatch({ type: "insert", nodes: [group, ...children], parent: null, index: doc.root.length })) return false;
  core.select([group.id]);
  return true;
}
