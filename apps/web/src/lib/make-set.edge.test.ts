import { readdirSync, readFileSync } from "node:fs";
import { FORMATS, parseDoc, validateDoc, type FormatKey } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { planSet } from "./make-set";

// "Make the set" on real designs: every seed template, turned into a design and made into the other standard sizes.
const dir = new URL("../../templates/seed/", import.meta.url);
const seeds = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => {
    const parsed = parseDoc(JSON.parse(readFileSync(new URL(f, dir), "utf8")), { kind: "template" });
    if (!parsed.ok) throw new Error(`${f} does not validate`);
    return { file: f, doc: parsed.doc };
  });
const sizes: FormatKey[] = ["ig-post", "ig-story", "yt-thumbnail", "poster", "invitation"];

describe("make the set on the seed templates", () => {
  for (const { file, doc } of seeds) {
    it(`${file}: every other size is a valid, distinct design titled with its size`, () => {
      const design = { ...doc, kind: "design" as const };
      const set = planSet(design, sizes);

      expect(set).toHaveLength(4);
      for (const member of set) {
        expect(validateDoc(member.doc, { kind: "design" }).ok, member.format).toBe(true);
        expect(member.doc.id, member.format).not.toBe(design.id);
        expect(member.doc.meta.title.endsWith(` · ${FORMATS[member.format as Exclude<FormatKey, "custom">].label}`), member.format).toBe(true);
      }
      expect(new Set(set.map((m) => m.doc.id)).size).toBe(set.length);
    });
  }
});
