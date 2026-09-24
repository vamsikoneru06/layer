import { describe, expect, it } from "vitest";
import { createEmptyDoc, parseDoc, validateDoc } from "./index";
import { sampleTemplate } from "./fixtures";
import type { Doc } from "./types";

function issuesOf(input: unknown) {
  const result = validateDoc(input);
  return result.ok ? [] : result.issues;
}

function mutate(fn: (doc: any) => void): Doc {
  const doc = structuredClone(sampleTemplate());
  fn(doc);
  return doc;
}

describe("validateDoc", () => {
  it("accepts a valid template", () => {
    expect(validateDoc(sampleTemplate())).toEqual({ ok: true, doc: sampleTemplate() });
  });

  it("accepts an empty document from the factory", () => {
    const doc = createEmptyDoc({ id: "d1", kind: "design", title: "Untitled", format: "ig-story" });
    expect(validateDoc(doc).ok).toBe(true);
    expect(doc.artboard).toMatchObject({ width: 1080, height: 1920 });
  });

  it("rejects non-objects", () => {
    expect(issuesOf(null)).toEqual([{ path: "", message: "expected object" }]);
    expect(issuesOf([])).toEqual([{ path: "", message: "expected object" }]);
  });

  it("reports missing and unknown keys with exact paths", () => {
    const issues = issuesOf(mutate((d) => {
      delete d.meta.format;
      d.nodes.heading.onclick = "alert(1)";
    }));
    expect(issues).toContainEqual({ path: "meta.format", message: "is required" });
    expect(issues).toContainEqual({ path: "nodes.heading.onclick", message: "is not allowed" });
  });

  it("rejects non-finite and out-of-range numbers", () => {
    const issues = issuesOf(mutate((d) => {
      d.nodes.photo1.transform.rotation = Number.NaN;
      d.nodes.photo1.opacity = 2;
      d.nodes.photo1.transform.scaleX = 0.001;
    }));
    expect(issues).toContainEqual({ path: "nodes.photo1.transform.rotation", message: "expected finite number" });
    expect(issues).toContainEqual({ path: "nodes.photo1.opacity", message: "must be between 0 and 1" });
    expect(issues).toContainEqual({ path: "nodes.photo1.transform.scaleX", message: "magnitude must be at least 0.01" });
  });

  it("rejects colours, fonts and enums outside the allowlist", () => {
    const issues = issuesOf(mutate((d) => {
      d.nodes.heading.color = "red";
      d.nodes.heading.font.family = "Comic Sans MS";
      d.nodes.heading.font.weight = 450;
      d.nodes.heading.lock = "maybe";
    }));
    expect(issues.map((i) => i.path)).toEqual(
      expect.arrayContaining([
        "nodes.heading.color",
        "nodes.heading.font.family",
        "nodes.heading.font.weight",
        "nodes.heading.lock",
      ]),
    );
  });

  it("guards against prototype-pollution keys", () => {
    const doc = JSON.parse(JSON.stringify(sampleTemplate()).replace('"heading":{"id":"heading"', '"__proto__":{"id":"__proto__"'));
    const issues = issuesOf(doc);
    expect(issues.some((i) => i.message === "reserved id")).toBe(true);
  });

  it("requires node ids to match their keys", () => {
    const issues = issuesOf(mutate((d) => { d.nodes.heading.id = "other"; }));
    expect(issues).toContainEqual({ path: "nodes.heading.id", message: "must match its key in nodes" });
  });

  it("rejects dangling references and unreachable nodes", () => {
    const issues = issuesOf(mutate((d) => {
      d.root = ["photo1", "ghost"];
    }));
    expect(issues).toContainEqual({ path: "root.1", message: "references missing node 'ghost'" });
    expect(issues).toContainEqual({ path: "nodes.heading", message: "is not reachable from root" });
  });

  it("rejects a node placed twice and group cycles", () => {
    const issues = issuesOf(mutate((d) => {
      d.nodes.g1 = { ...d.nodes.heading, id: "g1", type: "group", children: ["g2"] };
      d.nodes.g2 = { ...d.nodes.heading, id: "g2", type: "group", children: ["g1"] };
      for (const g of [d.nodes.g1, d.nodes.g2]) {
        for (const k of ["content", "font", "size", "color", "align", "lineHeight", "letterSpacing", "fit", "maxChars"]) delete g[k];
      }
      d.root.push("heading");
    }));
    expect(issues).toContainEqual({ path: "root.2", message: "node 'heading' is already placed under 'root'" });
    expect(issues.some((i) => i.message === "is part of a group cycle" || i.message === "is not reachable from root")).toBe(true);
  });

  it("requires frame photos to reference photo assets", () => {
    const missing = issuesOf(mutate((d) => { d.nodes.photo1.content.assetId = "nope"; }));
    expect(missing).toContainEqual({ path: "nodes.photo1.content.assetId", message: "references missing asset 'nope'" });
  });

  it("rejects SVG as a photo and URLs smuggled into asset refs", () => {
    const issues = issuesOf(mutate((d) => {
      d.assets.asset1.mime = "image/svg+xml";
      d.assets.asset1.src = "https://evil.example/pixel.gif";
    }));
    expect(issues).toContainEqual({ path: "assets.asset1.src", message: "is not allowed" });
  });

  it("validates path data in shapes", () => {
    const issues = issuesOf(mutate((d) => {
      d.nodes.photo1.shape = { kind: "path", d: "M0 0 L1 1 <script>" };
    }));
    expect(issues.some((i) => i.path === "nodes.photo1.shape.d")).toBe(true);
  });

  it("enforces the template node limit", () => {
    const issues = issuesOf(mutate((d) => {
      for (let i = 0; i < 150; i++) {
        d.nodes[`t${i}`] = { ...d.nodes.heading, id: `t${i}` };
        d.root.push(`t${i}`);
      }
    }));
    expect(issues.some((i) => i.path === "root" || i.path === "nodes")).toBe(true);
  });

  it("enforces kind when requested", () => {
    const result = validateDoc(sampleTemplate(), { kind: "design" });
    expect(result.ok).toBe(false);
  });

  it("rejects oversized documents before walking them", () => {
    const issues = issuesOf(mutate((d) => { d.meta.title = "x".repeat(1_100_000); }));
    expect(issues).toEqual([{ path: "", message: "document exceeds 1000000 bytes" }]);
  });
});

describe("parseDoc", () => {
  it("rejects documents from the future", () => {
    const result = parseDoc({ ...sampleTemplate(), schemaVersion: 99 });
    expect(result.ok).toBe(false);
  });
});
