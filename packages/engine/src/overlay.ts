import type { Doc, NodeId } from "@vash/schema";
import { handlePositions, HANDLE_DIRECTIONS, selectionFrame, type ResizeHandle } from "./handles";
import { boxCorners, type Box, type Point } from "./math";
import { photoExtent } from "./photos";
import { worldMatrix } from "./scene";
import type { Guide } from "./snapping";
import { toScreen, type Viewport } from "./viewport";

export interface OverlayState {
  selection: readonly NodeId[];
  hover: NodeId | null;
  guides: readonly Guide[];
  /** Marquee in artboard units. */
  marquee: Box | null;
  /** Content-only layers: dashed outline, no handles. */
  layoutLocked: boolean;
  /** Hide handles while a drag is in progress. */
  dragging: boolean;
  /** Crop mode: no handles; the whole photo is outlined, dashed. */
  cropping?: NodeId | null;
}

export const GUIDE_COLOR = "#FF3EA5";
const INK = "#1D1D1F";
const HALO = "#FFFFFF";
const HANDLE_SIZE = 8;

/** A line or closed outline drawn twice (halo, then ink) so it reads on any photo. */
function haloStroke(ctx: CanvasRenderingContext2D, points: Point[], closed: boolean, ink: string, dashed = false): void {
  const trace = () => {
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (closed) ctx.closePath();
  };
  ctx.setLineDash(dashed ? [5, 4] : []);
  ctx.lineWidth = 3;
  ctx.strokeStyle = HALO;
  trace();
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = ink;
  trace();
  ctx.stroke();
  ctx.setLineDash([]);
}

function outline(doc: Doc, id: NodeId, v: Viewport): Point[] | null {
  const n = doc.nodes[id];
  return n ? boxCorners(n.width, n.height, worldMatrix(doc, id)).map((p) => toScreen(v, p)) : null;
}

/** Draws the selection chrome in screen space (CSS px × dpr) on the overlay canvas. */
export function renderOverlay(ctx: CanvasRenderingContext2D, doc: Doc, v: Viewport, dpr: number, s: OverlayState): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (s.hover && !s.selection.includes(s.hover) && !s.dragging) {
    const pts = outline(doc, s.hover, v);
    if (pts) haloStroke(ctx, pts, true, INK);
  }

  const frame = selectionFrame(doc, s.selection);
  if (frame) {
    if (s.selection.length > 1) {
      for (const id of s.selection) {
        const pts = outline(doc, id, v);
        if (pts) haloStroke(ctx, pts, true, INK);
      }
    }
    const corners = boxCorners(frame.width, frame.height, frame.matrix).map((p) => toScreen(v, p));
    haloStroke(ctx, corners, true, INK, s.layoutLocked);

    if (!s.layoutLocked && !s.dragging && !s.cropping) {
      const h = handlePositions(frame, v);
      haloStroke(ctx, [h.n, h.rotate], false, INK);
      ctx.fillStyle = HALO;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(h.rotate.x, h.rotate.y, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      for (const key of Object.keys(HANDLE_DIRECTIONS) as ResizeHandle[]) {
        const p = h[key];
        ctx.fillRect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        ctx.strokeRect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      }
    }
  }

  const extent = s.cropping ? photoExtent(doc, s.cropping) : null;
  if (extent) haloStroke(ctx, extent.map((p) => toScreen(v, p)), true, INK, true);

  for (const g of s.guides) {
    const [a, b] = g.axis === "x" ? [{ x: g.at, y: g.from }, { x: g.at, y: g.to }] : [{ x: g.from, y: g.at }, { x: g.to, y: g.at }];
    haloStroke(ctx, [toScreen(v, a), toScreen(v, b)], false, GUIDE_COLOR);
  }

  if (s.marquee) {
    const m = s.marquee;
    const p = [{ x: m.minX, y: m.minY }, { x: m.maxX, y: m.minY }, { x: m.maxX, y: m.maxY }, { x: m.minX, y: m.maxY }].map((q) => toScreen(v, q));
    ctx.fillStyle = "rgba(29,29,31,0.06)";
    ctx.beginPath();
    p.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
    ctx.closePath();
    ctx.fill();
    haloStroke(ctx, p, true, INK, true);
  }
}
