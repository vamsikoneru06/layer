import type { Doc, Fill, FrameNode, Node, ShapeNode, StickerNode, TextNode } from "@vash/schema";
import { multiply, type Mat } from "./math";
import { drawOrder, parentOf, worldMatrix } from "./scene";
import { layoutText, type Measure } from "./text";
import type { Viewport } from "./viewport";

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/** What the renderer knows about an asset: decoded, still loading, or unavailable. */
export type ImageState = LoadedImage | "loading" | "missing";

export interface RenderOptions {
  measure: Measure;
  image: (assetId: string) => ImageState;
  /** Device pixels per CSS pixel. */
  dpr: number;
}

const PLACEHOLDER_FILL = "#ECECEE";
const PLACEHOLDER_INK = "#8E8E93";

export const fontString = (n: TextNode, size: number) => `${n.font.style} ${n.font.weight} ${size}px "${n.font.family}", system-ui, sans-serif`;

function paint(ctx: Ctx, fill: Fill, w: number, h: number): string | CanvasGradient {
  if (fill.type === "solid") return fill.color;
  // CSS convention: 0° points up, 90° right, across the node's box.
  const a = ((fill.angle - 90) * Math.PI) / 180;
  const dx = (Math.cos(a) * w) / 2;
  const dy = (Math.sin(a) * h) / 2;
  const g = ctx.createLinearGradient(-dx, -dy, dx, dy);
  for (const stop of fill.stops) g.addColorStop(stop.offset, stop.color);
  return g;
}

const pathCache = new Map<string, Path2D>();

/** A unit-box SVG path scaled to w×h and centred. Cached; absent where Path2D isn't available (tests). */
function unitPath(d: string, w: number, h: number): Path2D | null {
  if (typeof Path2D === "undefined") return null;
  const key = `${w}x${h}:${d}`;
  let p = pathCache.get(key);
  if (!p) {
    p = new Path2D();
    p.addPath(new Path2D(d), { a: w, b: 0, c: 0, d: h, e: -w / 2, f: -h / 2 });
    if (pathCache.size > 500) pathCache.clear();
    pathCache.set(key, p);
  }
  return p;
}

type Outline = { kind: "rect"; cornerRadius: number } | { kind: "ellipse" } | { kind: "polygon"; sides: number } | { kind: "path"; d: string };

/** Traces the outline on the current path; returns a Path2D instead for SVG paths. */
function trace(ctx: Ctx, shape: Outline, w: number, h: number): Path2D | null {
  ctx.beginPath();
  switch (shape.kind) {
    case "rect": {
      const r = Math.min(shape.cornerRadius, w / 2, h / 2);
      if (r > 0) ctx.roundRect(-w / 2, -h / 2, w, h, r);
      else ctx.rect(-w / 2, -h / 2, w, h);
      return null;
    }
    case "ellipse":
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      return null;
    case "polygon":
      for (let i = 0; i < shape.sides; i++) {
        const t = -Math.PI / 2 + (i * 2 * Math.PI) / shape.sides;
        const x = (w / 2) * Math.cos(t);
        const y = (h / 2) * Math.sin(t);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      return null;
    case "path":
      return unitPath(shape.d, w, h);
  }
}

function drawShape(ctx: Ctx, n: ShapeNode): void {
  const path = trace(ctx, n.geometry, n.width, n.height);
  if (n.geometry.kind === "path" && !path) return;
  if (n.fill) {
    ctx.fillStyle = paint(ctx, n.fill, n.width, n.height);
    if (path) ctx.fill(path);
    else ctx.fill();
  }
  if (n.stroke && n.stroke.width > 0) {
    ctx.strokeStyle = n.stroke.color;
    ctx.lineWidth = n.stroke.width;
    if (path) ctx.stroke(path);
    else ctx.stroke();
  }
}

function drawPlaceholder(ctx: Ctx, w: number, h: number, label: string): void {
  ctx.fillStyle = PLACEHOLDER_FILL;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  // Diagonal hatch, in artboard units so it reads as part of the layout.
  const step = Math.max(12, Math.min(w, h) / 12);
  ctx.strokeStyle = "rgba(0,0,0,0.06)";
  ctx.lineWidth = step / 6;
  ctx.beginPath();
  for (let x = -w / 2 - h; x < w / 2; x += step) {
    ctx.moveTo(x, h / 2);
    ctx.lineTo(x + h, -h / 2);
  }
  ctx.stroke();
  const size = Math.max(12, Math.min(64, Math.min(w, h) * 0.08));
  ctx.fillStyle = PLACEHOLDER_INK;
  ctx.font = `500 ${size}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, 0);
}

function drawFrame(ctx: Ctx, n: FrameNode, o: RenderOptions): void {
  const w = n.width;
  const h = n.height;
  ctx.save();
  const path = trace(ctx, n.shape, w, h);
  if (path) ctx.clip(path);
  else ctx.clip();
  const state = n.content ? o.image(n.content.assetId) : null;
  if (n.content && state && typeof state === "object") {
    // "Cover" fit, then the user's zoom and pan inside the frame.
    const scale = Math.max(w / state.width, h / state.height) * n.content.scale;
    const dw = state.width * scale;
    const dh = state.height * scale;
    ctx.drawImage(state.source, n.content.offsetX - dw / 2, n.content.offsetY - dh / 2, dw, dh);
  } else if (state === "missing") {
    drawPlaceholder(ctx, w, h, "Photo unavailable");
  } else if (state === "loading") {
    ctx.fillStyle = PLACEHOLDER_FILL;
    ctx.fillRect(-w / 2, -h / 2, w, h);
  } else {
    drawPlaceholder(ctx, w, h, "Drop a photo");
  }
  ctx.restore();
}

function drawText(ctx: Ctx, n: TextNode, o: RenderOptions): void {
  const layout = layoutText(n, o.measure);
  ctx.fillStyle = n.color;
  ctx.font = fontString(n, layout.size);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${n.letterSpacing}px`;
  const left = -n.width / 2;
  const top = -n.height / 2;
  for (const line of layout.lines) {
    const y = top + line.y + layout.lineHeight / 2;
    if (line.wordSpacing === 0) {
      ctx.fillText(line.text, left + line.x, y);
      continue;
    }
    let x = left + line.x;
    for (const word of line.text.split(" ")) {
      ctx.fillText(word, x, y);
      x += o.measure(`${word} `, n.font, layout.size) + n.letterSpacing * (word.length + 1) + line.wordSpacing;
    }
  }
}

function drawSticker(ctx: Ctx, n: StickerNode, o: RenderOptions): void {
  const state = o.image(n.assetId);
  if (typeof state === "object") ctx.drawImage(state.source, -n.width / 2, -n.height / 2, n.width, n.height);
  else {
    ctx.fillStyle = PLACEHOLDER_FILL;
    ctx.fillRect(-n.width / 2, -n.height / 2, n.width, n.height);
  }
}

export function drawNode(ctx: Ctx, n: Node, o: RenderOptions): void {
  switch (n.type) {
    case "shape":
      return drawShape(ctx, n);
    case "frame":
      return drawFrame(ctx, n, o);
    case "text":
      return drawText(ctx, n, o);
    case "sticker":
      return drawSticker(ctx, n, o);
    case "group":
      return;
  }
}

/** Opacity of a node times every enclosing group's. */
function effectiveOpacity(doc: Doc, id: string): number {
  let alpha = 1;
  for (let at: string | null = id; at; at = parentOf(doc, at)) alpha *= doc.nodes[at]?.opacity ?? 1;
  return alpha;
}

/**
 * Paints the artboard and its layers. `base` maps artboard units to device pixels
 * (viewport × dpr on screen; a plain scale for export).
 */
export function renderDoc(ctx: Ctx, doc: Doc, base: Mat, o: RenderOptions, opts: { shadow?: boolean } = {}): void {
  const { width, height, background } = doc.artboard;
  ctx.setTransform(...base);
  ctx.save();
  if (opts.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.14)";
    ctx.shadowBlur = 24 * o.dpr;
    ctx.shadowOffsetY = 6 * o.dpr;
  }
  ctx.fillStyle = paint(ctx, background, width, height);
  // Gradients are built around the origin; draw the background centred, then move back.
  ctx.translate(width / 2, height / 2);
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  for (const id of drawOrder(doc)) {
    const node = doc.nodes[id];
    if (!node) continue;
    ctx.setTransform(...multiply(base, worldMatrix(doc, id)));
    ctx.globalAlpha = effectiveOpacity(doc, id);
    drawNode(ctx, node, o);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Clears the canvas and paints the document through the viewport. */
export function renderScene(ctx: CanvasRenderingContext2D, doc: Doc, v: Viewport, o: RenderOptions): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const s = o.dpr * v.zoom;
  renderDoc(ctx, doc, [s, 0, 0, s, o.dpr * v.panX, o.dpr * v.panY], o, { shadow: true });
}
