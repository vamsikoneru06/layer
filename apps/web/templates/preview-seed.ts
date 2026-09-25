// Renders every seed template to one HTML page (approximate: SVG shapes + HTML text in foreignObject).
import { writeFileSync } from "node:fs";
import type { Doc, Fill, Node } from "@layer/schema";
import { seedTemplates } from "./seed-templates";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
let gid = 0;

function paint(fill: Fill | null, defs: string[]): string {
  if (!fill) return "none";
  if (fill.type === "solid") return fill.color;
  const id = `g${gid++}`;
  const a = ((fill.angle - 90) * Math.PI) / 180;
  const [x1, y1, x2, y2] = [0.5 - Math.cos(a) / 2, 0.5 - Math.sin(a) / 2, 0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2];
  defs.push(`<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${fill.stops.map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`).join("")}</linearGradient>`);
  return `url(#${id})`;
}

function polygonPoints(sides: number, w: number, h: number): string {
  return Array.from({ length: sides }, (_, i) => {
    const t = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    return `${(w / 2) * Math.cos(t)},${(h / 2) * Math.sin(t)}`;
  }).join(" ");
}

function node(n: Node, defs: string[]): string {
  const { x, y, rotation } = n.transform;
  const w = n.width;
  const h = n.height;
  const g = (inner: string) => `<g transform="translate(${x} ${y}) rotate(${rotation})" opacity="${n.opacity}">${inner}</g>`;
  if (n.type === "shape") {
    const fill = paint(n.fill, defs);
    const stroke = n.stroke ? `stroke="${n.stroke.color}" stroke-width="${n.stroke.width}"` : "";
    const geo = n.geometry;
    if (geo.kind === "rect") return g(`<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${geo.cornerRadius}" fill="${fill}" ${stroke}/>`);
    if (geo.kind === "ellipse") return g(`<ellipse rx="${w / 2}" ry="${h / 2}" fill="${fill}" ${stroke}/>`);
    if (geo.kind === "polygon") return g(`<polygon points="${polygonPoints(geo.sides, w, h)}" fill="${fill}" ${stroke}/>`);
    return g(`<path transform="translate(${-w / 2} ${-h / 2}) scale(${w} ${h})" d="${geo.d}" fill="${fill}"/>`);
  }
  if (n.type === "frame") {
    const id = `c${gid++}`;
    const s = n.shape;
    const clip =
      s.kind === "rect"
        ? `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${s.cornerRadius}"/>`
        : s.kind === "ellipse"
          ? `<ellipse rx="${w / 2}" ry="${h / 2}"/>`
          : `<path transform="translate(${-w / 2} ${-h / 2}) scale(${w} ${h})" d="${s.d}"/>`;
    defs.push(`<clipPath id="${id}">${clip}</clipPath>`);
    return g(
      `<g clip-path="url(#${id})"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="url(#ph)"/></g>` +
        `<text text-anchor="middle" dominant-baseline="middle" font-family="Inter" font-size="${Math.max(18, Math.min(w, h) / 12)}" fill="#6B7280">＋ ${esc(n.name)}</text>`,
    );
  }
  if (n.type === "text") {
    const f = n.font;
    const style = `width:${w}px;height:${h}px;font-family:'${f.family}';font-weight:${f.weight};font-style:${f.style};font-size:${n.size}px;color:${n.color};text-align:${n.align};line-height:${n.lineHeight};letter-spacing:${n.letterSpacing / 10}px;overflow:visible;white-space:pre-wrap;overflow-wrap:break-word`;
    return g(`<foreignObject x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" overflow="visible"><div xmlns="http://www.w3.org/1999/xhtml" style="${style}">${esc(n.content)}</div></foreignObject>`);
  }
  return "";
}

function render(doc: Doc): string {
  const defs: string[] = [];
  const body = doc.root.map((id) => node(doc.nodes[id]!, defs)).join("");
  const bg = paint(doc.artboard.background, defs);
  const { width: W, height: H } = doc.artboard;
  return `<figure><svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs>
<pattern id="ph" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#D9DEE5"/><path d="M0 40 L40 0" stroke="#C5CCD6" stroke-width="6"/></pattern>${defs.join("")}</defs>
<rect width="${W}" height="${H}" fill="${bg}"/>${body}</svg><figcaption><b>${esc(doc.meta.title)}</b><span>${doc.meta.format} · ${doc.meta.category}</span></figcaption></figure>`;
}

const families = [...new Set(seedTemplates().flatMap((d) => Object.values(d.nodes).flatMap((n) => (n.type === "text" ? [n.font.family] : []))))];
const fontsHref = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f.replace(/ /g, "+")}:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400`).join("&")}&display=swap`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Layer Seed Templates</title>
<link rel="stylesheet" href="${fontsHref}">
<style>body{margin:0;padding:32px;background:#E9E7E2;font-family:Inter,system-ui,sans-serif;color:#1d1d1f}h1{font-size:22px;margin:0 0 4px}p{margin:0 0 24px;color:#555}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:28px;align-items:start}
figure{margin:0}svg{width:100%;height:auto;display:block;box-shadow:0 6px 24px rgba(0,0,0,.12);border-radius:4px}
figcaption{display:flex;justify-content:space-between;gap:8px;font-size:13px;margin-top:8px}figcaption span{color:#777}</style></head>
<body><h1>Layer — seed templates (preview)</h1><p>Approximate render. Hatched areas are empty photo frames users fill with their own pictures.</p><main>${seedTemplates().map(render).join("")}</main></body></html>`;

writeFileSync(new URL("./preview.html", import.meta.url), html);
console.log("wrote templates/preview.html");
