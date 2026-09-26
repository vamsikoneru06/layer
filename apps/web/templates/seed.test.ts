import { readdirSync, readFileSync } from "node:fs";
import { CATEGORIES, FORMATS, lintTemplate, parseDoc, scanForPii, type Doc } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { seedTemplates } from "./seed-templates";

const dir = new URL("./seed/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const load = (file: string): unknown => JSON.parse(readFileSync(new URL(file, dir), "utf8"));

function parsed(file: string): Doc {
  const result = parseDoc(load(file), { kind: "template" });
  if (!result.ok) throw new Error(`${file}: ${JSON.stringify(result.issues)}`);
  return result.doc;
}

describe("seed templates", () => {
  it("ships 20 templates, 4 per format", () => {
    expect(files).toHaveLength(20);
    const perFormat = new Map<string, number>();
    for (const file of files) {
      const format = parsed(file).meta.format;
      perFormat.set(format, (perFormat.get(format) ?? 0) + 1);
    }
    expect(Object.fromEntries(perFormat)).toEqual(Object.fromEntries(Object.keys(FORMATS).map((f) => [f, 4])));
  });

  it("covers every gallery category", () => {
    expect(new Set(files.map((f) => parsed(f).meta.category))).toEqual(new Set(CATEGORIES));
  });

  it.each(files)("%s is a valid, lint-clean, PII-free template", (file) => {
    const doc = parsed(file);
    expect(`${doc.id}.json`).toBe(file);
    expect(lintTemplate(doc)).toEqual([]);
    expect(scanForPii(doc)).toEqual([]);
    expect(Object.keys(doc.assets)).toEqual([]);
    const size = FORMATS[doc.meta.format as keyof typeof FORMATS];
    expect({ width: doc.artboard.width, height: doc.artboard.height }).toEqual({ width: size.width, height: size.height });
  });

  it.each(files)("%s keeps text and photo frames on the canvas, with room for their text", (file) => {
    const doc = parsed(file);
    for (const node of Object.values(doc.nodes)) {
      if (node.type !== "text" && node.type !== "frame") continue;
      const left = node.transform.x - node.width / 2;
      const top = node.transform.y - node.height / 2;
      expect(left, `${node.id} left`).toBeGreaterThanOrEqual(0);
      expect(top, `${node.id} top`).toBeGreaterThanOrEqual(0);
      expect(left + node.width, `${node.id} right`).toBeLessThanOrEqual(doc.artboard.width);
      expect(top + node.height, `${node.id} bottom`).toBeLessThanOrEqual(doc.artboard.height);
      if (node.type === "text" && node.maxChars !== null) expect(node.content.length, node.id).toBeLessThanOrEqual(node.maxChars);
    }
  });

  it("matches the generator (run `pnpm --filter @vash/web templates:build` after editing seed-templates.ts)", () => {
    const generated = seedTemplates();
    expect(generated.map((d) => `${d.id}.json`).sort()).toEqual(files);
    for (const doc of generated) expect(load(`${doc.id}.json`)).toEqual(doc);
  });
});
