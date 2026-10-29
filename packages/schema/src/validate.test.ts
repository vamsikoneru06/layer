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

describe("optional shadow, alt and stroke dash", () => {
  const shadow = { color: "#00000080", blur: 12, offsetX: 4, offsetY: -8 };

  /** A template with a shape (box) inside a group (grp) next to a sticker, so every node type is covered. */
  function withAllTypes(fn?: (d: any) => void): Doc {
    return mutate((d) => {
      d.assets.sticker1 = { id: "sticker1", kind: "sticker", mime: "image/png", width: 300, height: 300 };
      d.nodes.box = {
        id: "box", type: "shape", name: "Box", transform: { x: 200, y: 200, rotation: 0, scaleX: 1, scaleY: 1 },
        width: 200, height: 100, opacity: 1, visible: true, lock: "free",
        geometry: { kind: "rect", cornerRadius: 0 }, fill: null, stroke: { color: "#000000", width: 4 },
      };
      d.nodes.grp = {
        id: "grp", type: "group", name: "Group", transform: { x: 500, y: 500, rotation: 0, scaleX: 1, scaleY: 1 },
        width: 200, height: 100, opacity: 1, visible: true, lock: "free", children: ["box"],
      };
      d.nodes.st = {
        id: "st", type: "sticker", name: "Sticker", transform: { x: 800, y: 200, rotation: 0, scaleX: 1, scaleY: 1 },
        width: 150, height: 150, opacity: 1, visible: true, lock: "free", assetId: "sticker1",
      };
      d.root.push("grp", "st");
      fn?.(d);
    });
  }

  it("accepts a node without any of the optional fields", () => {
    expect(validateDoc(withAllTypes()).ok).toBe(true);
    expect(validateDoc(withAllTypes((d) => { d.nodes.box.stroke = { color: "#000000", width: 4 }; })).ok).toBe(true);
  });

  it("accepts a shadow, an alt and a stroke dash on every node type", () => {
    const doc = withAllTypes((d) => {
      for (const id of ["photo1", "heading", "box", "st", "grp"]) {
        d.nodes[id].shadow = shadow;
        d.nodes[id].alt = `Alt text for ${id}`;
      }
      d.nodes.box.stroke.dash = "dashed";
    });
    expect(issuesOf(doc)).toEqual([]);
  });

  it("accepts null shadow, empty alt, and every stroke dash", () => {
    for (const dash of ["solid", "dashed", "dotted"] as const) {
      const doc = withAllTypes((d) => {
        d.nodes.heading.shadow = null;
        d.nodes.heading.alt = "";
        d.nodes.box.stroke.dash = dash;
      });
      expect(issuesOf(doc)).toEqual([]);
    }
  });

  it("accepts alt with spaces and printable punctuation", () => {
    const doc = withAllTypes((d) => { d.nodes.photo1.alt = "Two friends, sunset: at the beach (2026)!"; });
    expect(issuesOf(doc)).toEqual([]);
  });

  it("rejects a shadow colour that is not hex", () => {
    const issues = issuesOf(withAllTypes((d) => { d.nodes.photo1.shadow = { ...shadow, color: "red" }; }));
    expect(issues).toEqual([{ path: "nodes.photo1.shadow.color", message: "expected #RRGGBB or #RRGGBBAA" }]);
  });

  it("rejects a shadow blur above the limit", () => {
    const issues = issuesOf(withAllTypes((d) => { d.nodes.heading.shadow = { ...shadow, blur: 201 }; }));
    expect(issues).toEqual([{ path: "nodes.heading.shadow.blur", message: "must be between 0 and 200" }]);
  });

  it("rejects a shadow offset beyond the limit", () => {
    const issues = issuesOf(withAllTypes((d) => { d.nodes.box.shadow = { ...shadow, offsetY: -501 }; }));
    expect(issues).toEqual([{ path: "nodes.box.shadow.offsetY", message: "must be between -500 and 500" }]);
  });

  it("rejects a shadow with a missing or extra key", () => {
    const { blur: _blur, ...noBlur } = shadow;
    expect(issuesOf(withAllTypes((d) => { d.nodes.photo1.shadow = noBlur; })))
      .toEqual([{ path: "nodes.photo1.shadow.blur", message: "is required" }]);
    expect(issuesOf(withAllTypes((d) => { d.nodes.photo1.shadow = { ...shadow, spread: 4 }; })))
      .toEqual([{ path: "nodes.photo1.shadow.spread", message: "is not allowed" }]);
  });

  it("rejects a shadow that is not an object or null", () => {
    const issues = issuesOf(withAllTypes((d) => { d.nodes.st.shadow = "soft"; }));
    expect(issues).toEqual([{ path: "nodes.st.shadow", message: "expected object" }]);
  });

  it("rejects alt longer than the limit", () => {
    const issues = issuesOf(withAllTypes((d) => { d.nodes.photo1.alt = "x".repeat(251); }));
    expect(issues).toEqual([{ path: "nodes.photo1.alt", message: "length must be between 0 and 250" }]);
  });

  it("rejects alt with a newline, tab or other control character", () => {
    for (const alt of ["line one\nline two", "col\tcol", "bell\u0007", "c1\u0085"]) {
      const issues = issuesOf(withAllTypes((d) => { d.nodes.photo1.alt = alt; }));
      expect(issues).toEqual([{ path: "nodes.photo1.alt", message: "must not contain control characters" }]);
    }
  });

  it("rejects a stroke dash outside the allowlist", () => {
    const issues = issuesOf(withAllTypes((d) => { d.nodes.box.stroke.dash = "wavy"; }));
    expect(issues).toEqual([{ path: "nodes.box.stroke.dash", message: "must be one of: solid, dashed, dotted" }]);
  });

  it("rejects stroke on a frame and dash on a text node", () => {
    const issues = issuesOf(withAllTypes((d) => {
      d.nodes.photo1.stroke = { color: "#000000", width: 4, dash: "dotted" };
      d.nodes.heading.dash = "dotted";
    }));
    expect(issues).toContainEqual({ path: "nodes.photo1.stroke", message: "is not allowed" });
    expect(issues).toContainEqual({ path: "nodes.heading.dash", message: "is not allowed" });
  });
});

describe("optional text outline, highlight and list", () => {
  /** The sample template plus a shape (box), so text-only keys can be tried on a non-text node. */
  function withBox(fn: (d: any) => void): Doc {
    return mutate((d) => {
      d.nodes.box = {
        id: "box", type: "shape", name: "Box", transform: { x: 200, y: 200, rotation: 0, scaleX: 1, scaleY: 1 },
        width: 200, height: 100, opacity: 1, visible: true, lock: "free",
        geometry: { kind: "rect", cornerRadius: 0 }, fill: null, stroke: null,
      };
      d.root.push("box");
      fn(d);
    });
  }

  it("accepts a text node without the new keys", () => {
    expect(issuesOf(withBox(() => {}))).toEqual([]);
  });

  it("accepts every valid outline, highlight and list form on a text node", () => {
    const forms: Array<(d: any) => void> = [
      (d) => { d.nodes.heading.outline = { color: "#FF000080", width: 0 }; },
      (d) => { d.nodes.heading.outline = { color: "#112233", width: 20 }; },
      (d) => { d.nodes.heading.outline = null; },
      (d) => { d.nodes.heading.highlight = { color: "#FFFF00" }; },
      (d) => { d.nodes.heading.highlight = null; },
      (d) => { d.nodes.heading.list = "none"; },
      (d) => { d.nodes.heading.list = "bullet"; },
      (d) => { d.nodes.heading.list = "number"; },
    ];
    for (const form of forms) {
      expect(issuesOf(withBox(form))).toEqual([]);
    }
  });

  it("rejects an outline or highlight colour that is not hex", () => {
    const issues = issuesOf(withBox((d) => {
      d.nodes.heading.outline = { color: "red", width: 2 };
      d.nodes.heading.highlight = { color: "yellow" };
    }));
    expect(issues).toContainEqual({ path: "nodes.heading.outline.color", message: "expected #RRGGBB or #RRGGBBAA" });
    expect(issues).toContainEqual({ path: "nodes.heading.highlight.color", message: "expected #RRGGBB or #RRGGBBAA" });
  });

  it("rejects an outline width outside 0 to the limit", () => {
    const tooWide = issuesOf(withBox((d) => { d.nodes.heading.outline = { color: "#000000", width: 21 }; }));
    expect(tooWide).toEqual([{ path: "nodes.heading.outline.width", message: "must be between 0 and 20" }]);
    const negative = issuesOf(withBox((d) => { d.nodes.heading.outline = { color: "#000000", width: -1 }; }));
    expect(negative).toEqual([{ path: "nodes.heading.outline.width", message: "must be between 0 and 20" }]);
  });

  it("rejects an outline or highlight with a missing or extra key", () => {
    expect(issuesOf(withBox((d) => { d.nodes.heading.outline = { color: "#000000" }; })))
      .toEqual([{ path: "nodes.heading.outline.width", message: "is required" }]);
    expect(issuesOf(withBox((d) => { d.nodes.heading.outline = { color: "#000000", width: 2, blur: 1 }; })))
      .toEqual([{ path: "nodes.heading.outline.blur", message: "is not allowed" }]);
    expect(issuesOf(withBox((d) => { d.nodes.heading.highlight = { color: "#000000", width: 2 }; })))
      .toEqual([{ path: "nodes.heading.highlight.width", message: "is not allowed" }]);
  });

  it("rejects an outline or highlight that is neither an object nor null", () => {
    const issues = issuesOf(withBox((d) => {
      d.nodes.heading.outline = "thick";
      d.nodes.heading.highlight = 1;
    }));
    expect(issues).toContainEqual({ path: "nodes.heading.outline", message: "expected object" });
    expect(issues).toContainEqual({ path: "nodes.heading.highlight", message: "expected object" });
  });

  it("rejects a list value outside the allowlist, including null", () => {
    const unknown = issuesOf(withBox((d) => { d.nodes.heading.list = "checkbox"; }));
    expect(unknown).toEqual([{ path: "nodes.heading.list", message: "must be one of: none, bullet, number" }]);
    const nullList = issuesOf(withBox((d) => { d.nodes.heading.list = null; }));
    expect(nullList).toEqual([{ path: "nodes.heading.list", message: "must be one of: none, bullet, number" }]);
  });

  it("rejects the text-only keys on non-text nodes", () => {
    const issues = issuesOf(withBox((d) => {
      d.nodes.box.outline = { color: "#000000", width: 2 };
      d.nodes.box.highlight = { color: "#FFFF00" };
      d.nodes.box.list = "bullet";
      d.nodes.photo1.list = "number";
    }));
    expect(issues).toContainEqual({ path: "nodes.box.outline", message: "is not allowed" });
    expect(issues).toContainEqual({ path: "nodes.box.highlight", message: "is not allowed" });
    expect(issues).toContainEqual({ path: "nodes.box.list", message: "is not allowed" });
    expect(issues).toContainEqual({ path: "nodes.photo1.list", message: "is not allowed" });
  });
});

describe("optional filter duotone and pixelate, text curve", () => {
  /** The sample template plus a shape (box), so the curve can be tried on a non-text node. */
  function withBox(fn: (d: any) => void): Doc {
    return mutate((d) => {
      d.nodes.box = {
        id: "box", type: "shape", name: "Box", transform: { x: 200, y: 200, rotation: 0, scaleX: 1, scaleY: 1 },
        width: 200, height: 100, opacity: 1, visible: true, lock: "free",
        geometry: { kind: "rect", cornerRadius: 0 }, fill: null, stroke: null,
      };
      d.root.push("box");
      fn(d);
    });
  }

  it("accepts documents without the new fields", () => {
    expect(issuesOf(withBox(() => {}))).toEqual([]);
  });

  it("accepts every valid duotone, pixelate and curve form", () => {
    const forms: Array<(d: any) => void> = [
      (d) => { d.nodes.photo1.filters.duotone = { light: "#FFFFFF", dark: "#1A2B3C" }; },
      (d) => { d.nodes.photo1.filters.duotone = { light: "#FFFFFF80", dark: "#00000000" }; },
      (d) => { d.nodes.photo1.filters.duotone = null; },
      (d) => { d.nodes.photo1.filters.pixelate = 0; },
      (d) => { d.nodes.photo1.filters.pixelate = 50; },
      (d) => { d.nodes.photo1.filters.pixelate = 100; },
      (d) => { d.nodes.heading.curve = -100; },
      (d) => { d.nodes.heading.curve = 0; },
      (d) => { d.nodes.heading.curve = 100; },
    ];
    for (const form of forms) {
      expect(issuesOf(withBox(form))).toEqual([]);
    }
  });

  it("rejects a duotone colour that is not hex", () => {
    const issues = issuesOf(withBox((d) => { d.nodes.photo1.filters.duotone = { light: "white", dark: "#000000" }; }));
    expect(issues).toEqual([{ path: "nodes.photo1.filters.duotone.light", message: "expected #RRGGBB or #RRGGBBAA" }]);
  });

  it("rejects a duotone with a missing, extra or non-object value", () => {
    expect(issuesOf(withBox((d) => { d.nodes.photo1.filters.duotone = { light: "#FFFFFF" }; })))
      .toEqual([{ path: "nodes.photo1.filters.duotone.dark", message: "is required" }]);
    expect(issuesOf(withBox((d) => { d.nodes.photo1.filters.duotone = { light: "#FFFFFF", dark: "#000000", mid: "#808080" }; })))
      .toEqual([{ path: "nodes.photo1.filters.duotone.mid", message: "is not allowed" }]);
    expect(issuesOf(withBox((d) => { d.nodes.photo1.filters.duotone = "sepia"; })))
      .toEqual([{ path: "nodes.photo1.filters.duotone", message: "expected object" }]);
  });

  it("rejects pixelate outside 0 to 100 or not a number", () => {
    expect(issuesOf(withBox((d) => { d.nodes.photo1.filters.pixelate = 101; })))
      .toEqual([{ path: "nodes.photo1.filters.pixelate", message: "must be between 0 and 100" }]);
    expect(issuesOf(withBox((d) => { d.nodes.photo1.filters.pixelate = -1; })))
      .toEqual([{ path: "nodes.photo1.filters.pixelate", message: "must be between 0 and 100" }]);
    expect(issuesOf(withBox((d) => { d.nodes.photo1.filters.pixelate = "10"; })))
      .toEqual([{ path: "nodes.photo1.filters.pixelate", message: "expected finite number" }]);
  });

  it("rejects curve outside -100 to 100 on a text node", () => {
    expect(issuesOf(withBox((d) => { d.nodes.heading.curve = -101; })))
      .toEqual([{ path: "nodes.heading.curve", message: "must be between -100 and 100" }]);
    expect(issuesOf(withBox((d) => { d.nodes.heading.curve = 101; })))
      .toEqual([{ path: "nodes.heading.curve", message: "must be between -100 and 100" }]);
  });

  it("rejects curve on a shape or a photo frame", () => {
    const issues = issuesOf(withBox((d) => {
      d.nodes.box.curve = 40;
      d.nodes.photo1.curve = 40;
    }));
    expect(issues).toContainEqual({ path: "nodes.box.curve", message: "is not allowed" });
    expect(issues).toContainEqual({ path: "nodes.photo1.curve", message: "is not allowed" });
  });
});

describe("artboard background image fill", () => {
  const withBackground = (background: unknown): Doc => mutate((d) => { d.artboard.background = background; });

  it("accepts a background that covers the artboard with a photo in the asset list", () => {
    expect(validateDoc(withBackground({ type: "image", assetId: "asset1", fit: "cover" })).ok).toBe(true);
  });

  it("keeps solid and linear backgrounds valid", () => {
    expect(validateDoc(withBackground({ type: "solid", color: "#112233" })).ok).toBe(true);
    expect(validateDoc(withBackground({
      type: "linear", angle: 90, stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#FFFFFF" }],
    })).ok).toBe(true);
  });

  it("rejects an image fill whose photo is not in the asset list", () => {
    expect(issuesOf(withBackground({ type: "image", assetId: "nope", fit: "cover" })))
      .toEqual([{ path: "artboard.background.assetId", message: "references missing asset 'nope'" }]);
  });

  it("rejects an image fill that points at a sticker", () => {
    const doc = mutate((d) => {
      d.assets.logo = { id: "logo", kind: "sticker", mime: "image/png", width: 100, height: 100 };
      d.artboard.background = { type: "image", assetId: "logo", fit: "cover" };
    });
    expect(issuesOf(doc)).toEqual([{ path: "artboard.background.assetId", message: "asset 'logo' must be a photo" }]);
  });

  it("rejects a fill kind outside the allowlist, and lists image among the choices", () => {
    expect(issuesOf(withBackground({ type: "pattern", assetId: "asset1", fit: "cover" })))
      .toEqual([{ path: "artboard.background.type", message: "must be one of: solid, linear, image" }]);
  });

  it("rejects a fit other than cover, an id that is not a string, and extra keys", () => {
    expect(issuesOf(withBackground({ type: "image", assetId: "asset1", fit: "contain" })))
      .toEqual([{ path: "artboard.background.fit", message: "must be one of: cover" }]);
    expect(issuesOf(withBackground({ type: "image", assetId: 42, fit: "cover" })))
      .toEqual([{ path: "artboard.background.assetId", message: "expected id [A-Za-z0-9_-]{1,64}" }]);
    expect(issuesOf(withBackground({ type: "image", assetId: "asset1", fit: "cover", url: "https://evil.example/a.jpg" })))
      .toEqual([{ path: "artboard.background.url", message: "is not allowed" }]);
  });

  it("does not allow an image fill on a shape", () => {
    const issues = issuesOf(mutate((d) => {
      d.nodes.box = {
        id: "box", type: "shape", name: "Box", transform: { x: 200, y: 200, rotation: 0, scaleX: 1, scaleY: 1 },
        width: 200, height: 100, opacity: 1, visible: true, lock: "free",
        geometry: { kind: "rect", cornerRadius: 0 }, fill: { type: "image", assetId: "asset1", fit: "cover" }, stroke: null,
      };
      d.root.push("box");
    }));
    expect(issues).toEqual([{ path: "nodes.box.fill.type", message: "must be one of: solid, linear" }]);
  });
});
