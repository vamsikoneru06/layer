import { describe, expect, it } from "vitest";
import { lintTemplate, migrateDoc, replaceAssetIds, scanForPii, scrubForPublish, validateDoc, validatePathData } from "./index";
import { sampleTemplate } from "./fixtures";

describe("validatePathData", () => {
  it.each([
    "M0 0 L1 1 Z",
    "M0,0 C0.5,0 1,0.5 1,1 z",
    "m.5.5 h.25 v-.25 a0.1 0.1 0 0 1 0.2 0.2 Z",
    "M0 0 L1 0 1 1 0 1Z",
  ])("accepts %s", (d) => {
    expect(validatePathData(d, 1000)).toEqual({ ok: true });
  });

  it.each([
    ["", "path is empty"],
    ["L1 1", "path must start with a moveto"],
    ["M0 0 L1", "'L' expects a multiple of 2 numbers, got 1"],
    ["M0 0 A1 1 0 2 1 1 1", "arc large-arc flag must be 0 or 1"],
    ["M0 0 url(#x)", "unexpected character 'u' at 5"],
    ["M0 0 Z 1", "'Z' takes no arguments"],
  ])("rejects %j", (d, error) => {
    expect(validatePathData(d, 1000)).toEqual({ ok: false, error });
  });

  it("enforces a length limit", () => {
    expect(validatePathData("M0 0 " + "L1 1 ".repeat(100), 50).ok).toBe(false);
  });
});

describe("migrateDoc", () => {
  it("passes current documents through untouched", () => {
    const doc = sampleTemplate();
    expect(migrateDoc(doc)).toEqual({ ok: true, doc, migrated: false });
  });

  it("applies migrations in order and bumps the version", () => {
    const migrations = [
      { from: 1, migrate: (d: Record<string, unknown>) => ({ ...d, a: 1 }) },
      { from: 2, migrate: (d: Record<string, unknown>) => ({ ...d, b: (d.a as number) + 1 }) },
    ];
    const result = migrateDoc({ schemaVersion: 1 }, migrations, 3);
    expect(result).toEqual({ ok: true, doc: { schemaVersion: 3, a: 1, b: 2 }, migrated: true });
  });

  it("fails on a gap in the migration chain", () => {
    expect(migrateDoc({ schemaVersion: 1 }, [], 2)).toEqual({ ok: false, error: "no migration from schemaVersion 1" });
  });

  it("rejects missing or invalid versions", () => {
    expect(migrateDoc({}).ok).toBe(false);
    expect(migrateDoc({ schemaVersion: 0 }).ok).toBe(false);
  });
});

describe("lintTemplate", () => {
  it("passes a template with editable text", () => {
    expect(lintTemplate(sampleTemplate())).toEqual([]);
  });

  it("requires a placeholder or editable text", () => {
    const doc = sampleTemplate();
    doc.nodes.heading!.lock = "locked";
    expect(lintTemplate(doc)).toContainEqual({
      path: "nodes",
      message: "template needs at least one placeholder frame or editable text layer",
    });
  });

  it("flags empty non-placeholder frames", () => {
    const doc = sampleTemplate();
    const frame = doc.nodes.photo1!;
    if (frame.type !== "frame") throw new Error("fixture");
    doc.nodes.photo1 = { ...frame, content: null };
    expect(lintTemplate(doc)).toContainEqual({ path: "nodes.photo1", message: "empty frame must be marked as a placeholder" });
  });
});

describe("scanForPii", () => {
  it("finds and masks emails and phone numbers", () => {
    const doc = sampleTemplate();
    const heading = doc.nodes.heading!;
    if (heading.type !== "text") throw new Error("fixture");
    doc.nodes.heading = { ...heading, content: "Call +91 98765 43210 or mail riya.s@example.com" };
    const findings = scanForPii(doc);
    expect(findings.map((f) => f.kind).sort()).toEqual(["email", "phone"]);
    for (const f of findings) {
      expect(f.masked).toContain("•");
      expect(f.masked).not.toContain("98765");
    }
  });

  it("ignores short numbers like dates and prices", () => {
    const doc = sampleTemplate();
    const heading = doc.nodes.heading!;
    if (heading.type !== "text") throw new Error("fixture");
    doc.nodes.heading = { ...heading, content: "Sale 50% off, 24/09/2026, ₹499" };
    expect(scanForPii(doc)).toEqual([]);
  });
});

describe("scrubForPublish", () => {
  it("replaces unkept photos with placeholders and drops their assets", () => {
    const doc = sampleTemplate();
    const scrubbed = scrubForPublish(doc, new Set());
    expect(scrubbed.nodes.photo1).toMatchObject({ content: null, placeholder: true });
    expect(scrubbed.assets).toEqual({});
    expect(validateDoc(scrubbed).ok).toBe(true);
    expect(doc.nodes.photo1).toMatchObject({ placeholder: false }); // input untouched
  });

  it("keeps attested photos", () => {
    const scrubbed = scrubForPublish(sampleTemplate(), new Set(["asset1"]));
    expect(scrubbed.nodes.photo1).toMatchObject({ content: { assetId: "asset1" } });
    expect(Object.keys(scrubbed.assets)).toEqual(["asset1"]);
  });
});

describe("replaceAssetIds", () => {
  it("renames asset ids in frames and the assets map, leaving the input untouched", () => {
    const doc = sampleTemplate();
    const next = replaceAssetIds(doc, new Map([["asset1", "copy1"]]));
    expect(next.nodes.photo1).toMatchObject({ content: { assetId: "copy1" } });
    expect(next.assets).toEqual({ copy1: { ...doc.assets.asset1, id: "copy1" } });
    expect(doc.assets.asset1).toBeDefined();
    expect(replaceAssetIds(doc, new Map())).toEqual(doc);
  });
});
