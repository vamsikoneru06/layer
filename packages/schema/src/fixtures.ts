import { defaultFilters } from "./factory";
import type { Doc, FrameNode, TextNode } from "./types";

/** Small, valid template used by tests across packages. */
export function sampleTemplate(): Doc {
  const frame: FrameNode = {
    id: "photo1",
    type: "frame",
    name: "Main photo",
    transform: { x: 540, y: 400, rotation: 0, scaleX: 1, scaleY: 1 },
    width: 800,
    height: 600,
    opacity: 1,
    visible: true,
    lock: "content-only",
    shape: { kind: "rect", cornerRadius: 24 },
    content: { assetId: "asset1", offsetX: 0, offsetY: 0, scale: 1 },
    filters: defaultFilters(),
    placeholder: false,
  };
  const heading: TextNode = {
    id: "heading",
    type: "text",
    name: "Heading",
    transform: { x: 540, y: 900, rotation: 0, scaleX: 1, scaleY: 1 },
    width: 900,
    height: 120,
    opacity: 1,
    visible: true,
    lock: "content-only",
    content: "Happy birthday, Riya!",
    font: { family: "Poppins", weight: 700, style: "normal" },
    size: 72,
    color: "#16161A",
    align: "center",
    lineHeight: 1.2,
    letterSpacing: 0,
    fit: "shrink",
    maxChars: 40,
  };
  return {
    schemaVersion: 2,
    id: "doc1",
    kind: "template",
    meta: { title: "Birthday post", category: "celebrations", tags: ["party"], format: "ig-post" },
    artboard: { width: 1080, height: 1080, background: { type: "solid", color: "#FFF4E6" } },
    root: ["photo1", "heading"],
    nodes: { photo1: frame, heading },
    assets: { asset1: { id: "asset1", kind: "photo", mime: "image/jpeg", width: 4000, height: 3000 } },
  };
}
