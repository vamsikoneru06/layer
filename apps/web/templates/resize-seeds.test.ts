import { readdirSync, readFileSync } from "node:fs";
import { resizeDoc, worldBounds } from "@vash/engine";
import { FORMATS, parseDoc, validateDoc, type Doc, type FormatKey } from "@vash/schema";
import { describe, expect, it } from "vitest";

// "Make the set" on real designs: every seed template, made into every other size.
const dir = new URL("./seed/", import.meta.url);
const seeds = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => {
    const parsed = parseDoc(JSON.parse(readFileSync(new URL(f, dir), "utf8")), { kind: "template" });
    if (!parsed.ok) throw new Error(`${f} does not validate`);
    return { file: f, doc: parsed.doc };
  });
const targets = Object.entries(FORMATS).map(([format, f]) => ({ format: format as FormatKey, width: f.width, height: f.height }));

const offArtboard = (doc: Doc) =>
  doc.root.filter((id) => {
    const b = worldBounds(doc, id)!;
    return b.minX < -1 || b.minY < -1 || b.maxX > doc.artboard.width + 1 || b.maxY > doc.artboard.height + 1;
  });

describe("resizeDoc on the seed templates", () => {
  for (const { file, doc } of seeds) {
    it(`${file}: every other size validates and nothing new leaves the artboard`, () => {
      const before = new Set(offArtboard(doc)); // a few seeds bleed a shape off the edge on purpose
      for (const target of targets.filter((t) => t.format !== doc.meta.format)) {
        const { doc: out } = resizeDoc(doc, target);
        const valid = validateDoc(out, { kind: "template" });
        expect(valid.ok ? [] : valid.issues, `${target.format}`).toEqual([]);
        expect(offArtboard(out).filter((id) => !before.has(id)), `${target.format}`).toEqual([]);
      }
    });
  }
});
