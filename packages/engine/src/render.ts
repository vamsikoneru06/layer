import type { Doc, Fill, FrameNode, Node, Shadow, ShapeNode, StickerNode, TextNode } from "@vash/schema";
import { isNeutral, type FilterFn } from "./filters";
import { multiply, type Mat } from "./math";
import { drawOrder, parentOf, worldMatrix } from "./scene";
import { graphemeCount, graphemes, LIST_INDENT, layoutText, type Measure, type TextLayout } from "./text";
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
  /** A layer not to paint (the text being typed into, which the editor draws itself). */
  hidden?: string | null;
  /** Applies photo filters (WebGL2). Without it, photos are drawn unfiltered. */
  filter?: FilterFn;
}

const PLACEHOLDER_FILL = "#ECECEE";
const PLACEHOLDER_INK = "#8E8E93";

export const fontString = (n: TextNode, size: number) => `${n.font.style} ${n.font.weight} ${size}px "${n.font.family}", system-ui, sans-serif`;

function paint(ctx: Ctx, fill: Fill, w: number, h: number): string | CanvasGradient {
  if (fill.type === "solid") return fill.color;
  // An image fill is drawn over this white base (see drawBackgroundImage). Only the artboard background holds one.
  if (fill.type === "image") return "#FFFFFF";
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
    const { color, width, dash = "solid" } = n.stroke;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    // Dash lengths are in node units, like the stroke width, so they scale with the node.
    if (dash !== "solid") {
      ctx.setLineDash(dash === "dashed" ? [3 * width, 2 * width] : [0, 2 * width]);
      if (dash === "dotted") ctx.lineCap = "round";
    }
    if (path) ctx.stroke(path);
    else ctx.stroke();
    if (dash !== "solid") {
      ctx.setLineDash([]);
      ctx.lineCap = "butt";
    }
  }
}

/**
 * Canvas shadows are in device pixels and ignore the transform, so the document-pixel values are scaled by
 * the node's device scale (`scale`), which keeps a shadow the same at every zoom and in exports.
 */
function setShadow(ctx: Ctx, sh: Shadow, scale: number): void {
  ctx.shadowColor = sh.color;
  ctx.shadowBlur = sh.blur * scale;
  ctx.shadowOffsetX = sh.offsetX * scale;
  ctx.shadowOffsetY = sh.offsetY * scale;
}

/**
 * Paints only the shadow of a frame's outline: the outline itself is drawn far outside the canvas and the shadow
 * offset points back at where the frame really is, so a transparent photo never shows a filled shape behind it.
 * `m` is the frame's device matrix; the far shift is in the frame's own units, so it is mapped through `m`.
 */
function castShadow(ctx: Ctx, n: FrameNode, sh: Shadow, m: Mat): void {
  const scale = Math.hypot(m[0], m[1]) || 1;
  const far = 100_000 / scale;
  ctx.save();
  ctx.shadowColor = sh.color;
  ctx.shadowBlur = sh.blur * scale;
  ctx.shadowOffsetX = sh.offsetX * scale - m[0] * far;
  ctx.shadowOffsetY = sh.offsetY * scale - m[1] * far;
  ctx.translate(far, 0);
  ctx.fillStyle = "#000";
  const path = trace(ctx, n.shape, n.width, n.height);
  if (path) ctx.fill(path);
  else ctx.fill();
  ctx.restore();
}

function clearShadow(ctx: Ctx): void {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
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

/** Filter step, in px: resizing within a step reuses the cached result instead of filtering again. */
const FILTER_STEP = 128;

/**
 * The photo to draw for a frame: filtered at the size it covers on this canvas (so on-screen previews
 * stay cheap and exports get full resolution), never above the photo's own resolution.
 */
function frameSource(ctx: Ctx, n: FrameNode, img: LoadedImage, drawn: { x: number; y: number; w: number; h: number }, o: RenderOptions): CanvasImageSource {
  if (!o.filter || isNeutral(n.filters)) return img.source;
  const m = "getTransform" in ctx ? ctx.getTransform() : null;
  const device = m ? Math.hypot(m.a, m.b) : 1;
  const width = Math.max(1, Math.min(img.width, Math.ceil((drawn.w * device) / FILTER_STEP) * FILTER_STEP));
  const height = Math.max(1, Math.round((width * img.height) / img.width));
  // The frame's box, as fractions of the drawn photo (for the vignette).
  const visible = [(-n.width / 2 - drawn.x) / drawn.w, (-n.height / 2 - drawn.y) / drawn.h, (n.width / 2 - drawn.x) / drawn.w, (n.height / 2 - drawn.y) / drawn.h] as const;
  return o.filter(img.source, width, height, n.filters, visible) ?? img.source;
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
    const drawn = { x: n.content.offsetX - dw / 2, y: n.content.offsetY - dh / 2, w: dw, h: dh };
    ctx.drawImage(frameSource(ctx, n, state, drawn, o), drawn.x, drawn.y, dw, dh);
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

/** Highlight padding and corner radius, as fractions of the font size. */
const HIGHLIGHT_PAD = 0.15;
const HIGHLIGHT_RADIUS = 0.2;

/**
 * Radius of the arc that a line `width` px wide bends around for `curve` (non-zero, -100 to 100). At ±100 the width
 * spans a half circle (radius width / π); smaller curves have a larger radius, so the text bends less.
 */
export function arcRadius(width: number, curve: number): number {
  return width / ((Math.abs(curve) / 100) * Math.PI);
}

/**
 * Where a glyph sits on a curved line, in box units from the box centre. The arc's centre is below the text for an
 * arch (positive curve) and above it for a smile. `radius` is the arc's centre line, `offset` how far the line sits
 * above that centre line (lines stack outward for an arch and inward for a smile), and `angle` the glyph's angle
 * from the arc's top (or bottom) point, positive to the right. `rotation` turns the glyph onto the arc's tangent.
 */
export function arcPoint(radius: number, curve: number, offset: number, angle: number): { x: number; y: number; rotation: number } {
  const sign = Math.sign(curve);
  const r = radius + sign * offset;
  return { x: r * Math.sin(angle), y: sign * (radius - r * Math.cos(angle)), rotation: sign * angle };
}

/**
 * The angle from the arc's top (or bottom) point to the centre of each glyph, so the whole line is centred on that
 * point. `inks` are the glyph widths; `advances` are the room each takes on the line (its width plus any letter and
 * word spacing). Lengths along the centre line are divided by `radius`.
 */
export function arcAngles(inks: readonly number[], advances: readonly number[], radius: number): number[] {
  const total = advances.reduce((sum, a) => sum + a, 0);
  let at = 0;
  return inks.map((ink, i) => {
    const centre = at + ink / 2 - total / 2;
    at += advances[i] ?? 0;
    return centre / radius;
  });
}

/**
 * Draws a curved text layer. Each grapheme is placed on the arc and turned to its tangent, every line on its own
 * ring around the same centre. Outline strokes go under all the fills, as in straight text. The highlight band is
 * not drawn, since it would not follow the curve.
 */
function drawCurvedText(ctx: Ctx, n: TextNode, layout: TextLayout, o: RenderOptions): void {
  const curve = n.curve ?? 0;
  const size = layout.size;
  const radius = arcRadius(n.width, curve);
  const glyphs: Array<{ text: string; ink: number; x: number; y: number; rotation: number }> = [];
  layout.lines.forEach((line, i) => {
    // Line i's centre sits (layout.lines.length - 1) / 2 - i line heights above the block's middle, as in straight text.
    const offset = ((layout.lines.length - 1) / 2 - i) * layout.lineHeight;
    const items: Array<{ text: string; ink: number; advance: number }> = [];
    if (line.marker) items.push({ text: line.marker, ink: o.measure(line.marker, n.font, size), advance: LIST_INDENT * size });
    for (const g of graphemes(line.text)) {
      const ink = o.measure(g, n.font, size);
      items.push({ text: g, ink, advance: ink + n.letterSpacing + (g === " " ? line.wordSpacing : 0) });
    }
    const angles = arcAngles(
      items.map((item) => item.ink),
      items.map((item) => item.advance),
      radius,
    );
    items.forEach((item, k) => glyphs.push({ text: item.text, ink: item.ink, ...arcPoint(radius, curve, offset, angles[k] ?? 0) }));
  });

  ctx.save();
  ctx.font = fontString(n, size);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const paint = (method: "strokeText" | "fillText") => {
    for (const g of glyphs) {
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.rotation);
      ctx[method](g.text, -g.ink / 2, 0);
      ctx.restore();
    }
  };
  if (n.outline && n.outline.width > 0) {
    ctx.lineWidth = n.outline.width * 2;
    ctx.lineJoin = "round";
    ctx.strokeStyle = n.outline.color;
    paint("strokeText");
  }
  ctx.fillStyle = n.color;
  paint("fillText");
  ctx.restore();
}

/**
 * Draws a text layer: highlight bands behind each line, then the outline strokes, then the fills, so the outline
 * sits behind the letters and never covers a neighbouring word. List markers are drawn with the text, in the indent.
 * Wrapped in save/restore so the outline's line settings never reach the next node. A curved layer is drawn on an arc.
 */
function drawText(ctx: Ctx, n: TextNode, o: RenderOptions): void {
  const layout = layoutText(n, o.measure);
  if (n.curve) return drawCurvedText(ctx, n, layout, o);
  const size = layout.size;
  const left = -n.width / 2;
  const top = -n.height / 2;
  // Every piece of text to paint, as its own run (a whole line, or one word of a justified line).
  const runs: Array<{ text: string; x: number; y: number }> = [];
  for (const line of layout.lines) {
    const y = top + line.y + layout.lineHeight / 2;
    if (line.marker) runs.push({ text: line.marker, x: left, y });
    if (line.wordSpacing === 0) {
      runs.push({ text: line.text, x: left + line.x, y });
      continue;
    }
    let x = left + line.x;
    for (const word of line.text.split(" ")) {
      runs.push({ text: word, x, y });
      x += o.measure(`${word} `, n.font, size) + n.letterSpacing * (graphemeCount(word) + 1) + line.wordSpacing;
    }
  }

  ctx.save();
  ctx.font = fontString(n, size);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${n.letterSpacing}px`;

  if (n.highlight) {
    const pad = HIGHLIGHT_PAD * size;
    const h = size + 2 * pad;
    ctx.fillStyle = n.highlight.color;
    for (const line of layout.lines) {
      if (line.text === "") continue;
      // A justified line is drawn to the column's edge (its word spacing adds up to that), so its band reaches there too.
      const w = line.width + line.wordSpacing * (line.text.split(" ").length - 1);
      const y = top + line.y + layout.lineHeight / 2;
      ctx.beginPath();
      ctx.roundRect(left + line.x - pad, y - h / 2, w + 2 * pad, h, HIGHLIGHT_RADIUS * size);
      ctx.fill();
    }
  }

  if (n.outline && n.outline.width > 0) {
    // The stroke is centred on the glyph edge, so half of it is hidden under the fill; double the width to show the full outline.
    ctx.lineWidth = n.outline.width * 2;
    ctx.lineJoin = "round";
    ctx.strokeStyle = n.outline.color;
    for (const r of runs) ctx.strokeText(r.text, r.x, r.y);
  }

  ctx.fillStyle = n.color;
  for (const r of runs) ctx.fillText(r.text, r.x, r.y);
  ctx.restore();
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
 * The node's shadow, or the nearest enclosing group's. A group paints nothing itself, so its shadow is
 * applied to each child that has none of its own (not to the group's drawing as a whole).
 */
function effectiveShadow(doc: Doc, id: string): Shadow | null {
  for (let at: string | null = id; at; at = parentOf(doc, at)) {
    const shadow = doc.nodes[at]?.shadow;
    if (shadow) return shadow;
  }
  return null;
}

/**
 * Covers the artboard with a background photo, centred, with the same cover fit as a frame. Drawn from the centre of
 * the artboard (the caller has translated there). The photo can overhang the artboard on one side, so it is clipped.
 * While it loads, or if it is missing, the white base painted by `paint` stays.
 */
function drawBackgroundImage(ctx: Ctx, assetId: string, w: number, h: number, o: RenderOptions): void {
  const state = o.image(assetId);
  if (typeof state !== "object") return;
  const scale = Math.max(w / state.width, h / state.height);
  const dw = state.width * scale;
  const dh = state.height * scale;
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  ctx.clip();
  ctx.drawImage(state.source, -dw / 2, -dh / 2, dw, dh);
}

/**
 * Paints the artboard and its layers. `base` maps artboard units to device pixels
 * (viewport × dpr on screen; a plain scale for export).
 */
export function renderDoc(ctx: Ctx, doc: Doc, base: Mat, o: RenderOptions, opts: { shadow?: boolean; background?: boolean } = {}): void {
  const { width, height, background } = doc.artboard;
  ctx.setTransform(...base);
  if (opts.background !== false) {
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
    if (background.type === "image") {
      // The white base above already casts the artboard's shadow; the photo must not cast a second one.
      clearShadow(ctx);
      drawBackgroundImage(ctx, background.assetId, width, height, o);
    }
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  for (const id of drawOrder(doc)) {
    const node = doc.nodes[id];
    if (!node || id === o.hidden) continue;
    const m = multiply(base, worldMatrix(doc, id));
    ctx.setTransform(...m);
    ctx.globalAlpha = effectiveOpacity(doc, id);
    // A group paints nothing, so its shadow reaches its children. A frame clips its photo, which would hide its
    // own shadow, so the frame's outline casts the shadow first (castShadow) and the photo is drawn without one.
    const shadow = node.type === "group" ? null : effectiveShadow(doc, id);
    if (shadow && node.type === "frame") castShadow(ctx, node, shadow, m);
    else if (shadow) setShadow(ctx, shadow, Math.hypot(m[0], m[1]));
    drawNode(ctx, node, o);
    if (shadow && node.type !== "frame") clearShadow(ctx);
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
