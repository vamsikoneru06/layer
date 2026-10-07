import { validateDoc, type Doc, type Node, type NodeType } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import type { Plan } from "./selection-utils";
import { planPasteStyle, STYLE_FIELDS, styleOf } from "./style";
import { docWith, ellipse, frame, group, rect, text } from "./test-docs";

const ok = (plan: Plan) => {
  if (!plan.ok) throw new Error(plan.reason);
  return plan;
};
const run = (doc: Doc, plan: Plan) => applyCommand(doc, ok(plan).command).doc;
const reason = (plan: Plan) => (plan.ok ? "" : plan.reason);

const sticker = (id: string): Node => {
  const { name, transform, width, height, opacity, visible, lock } = rect(id, {});
  return { id, name, transform, width, height, opacity, visible, lock, type: "sticker", assetId: "asset1" };
};

describe("STYLE_FIELDS", () => {
  it("pins the style fields of every node type", () => {
    expect(STYLE_FIELDS).toEqual({
      frame: ["opacity", "filters"],
      text: ["opacity", "font", "size", "color", "align", "lineHeight", "letterSpacing", "fit"],
      shape: ["opacity", "fill", "stroke"],
      sticker: ["opacity"],
      group: ["opacity"],
    });
  });

  it("accounts for every field of every node type, so a new schema field has to be classified", () => {
    const notStyle: Record<NodeType, string[]> = {
      frame: ["id", "type", "name", "transform", "width", "height", "visible", "lock", "shape", "content", "placeholder"],
      text: ["id", "type", "name", "transform", "width", "height", "visible", "lock", "content", "maxChars"],
      shape: ["id", "type", "name", "transform", "width", "height", "visible", "lock", "geometry"],
      sticker: ["id", "type", "name", "transform", "width", "height", "visible", "lock", "assetId"],
      group: ["id", "type", "name", "transform", "width", "height", "visible", "lock", "children"],
    };
    const samples: Node[] = [frame("f", {}), text("t", {}), rect("s", {}), sticker("k"), group("g", {}, [])];
    for (const node of samples) {
      const style = STYLE_FIELDS[node.type] as readonly string[];
      expect([...Object.keys(node)].sort(), node.type).toEqual([...style, ...notStyle[node.type]].sort());
    }
  });
});

describe("styleOf", () => {
  it("captures the style fields and the type, as a copy", () => {
    const source = { ...rect("a", {}), opacity: 0.4, stroke: { color: "#00FF00", width: 6 } };
    const style = styleOf(source);
    expect(style).toEqual({ type: "shape", fields: { opacity: 0.4, fill: { type: "solid", color: "#FF0000" }, stroke: { color: "#00FF00", width: 6 } } });
    expect(style.fields.stroke).not.toBe(source.stroke);
  });

  it("leaves out identity, geometry and content", () => {
    const t = text("t", { x: 10 }, "Secret words");
    expect(Object.keys(styleOf(t).fields).sort()).toEqual([...STYLE_FIELDS.text].sort());
    expect(JSON.stringify(styleOf(t))).not.toContain("Secret words");
  });
});

describe("planPasteStyle", () => {
  const redRect = { ...rect("src", {}), opacity: 0.5, fill: { type: "solid" as const, color: "#112233" }, stroke: { color: "#FFFFFF", width: 4 } };

  it("pastes onto layers of the same type and keeps their identity, size and geometry", () => {
    const doc = docWith([redRect, ellipse("e", { x: 400 }, 80, 30), rect("r", { x: 700 })]);
    const next = run(doc, planPasteStyle(doc, ["e", "r"], "design", styleOf(redRect)));
    expect(next.nodes.e).toEqual({ ...doc.nodes.e, opacity: 0.5, fill: redRect.fill, stroke: redRect.stroke });
    expect(next.nodes.e).toMatchObject({ geometry: { kind: "ellipse" }, width: 80, height: 30, name: "e" });
    expect(next.nodes.src).toBe(doc.nodes.src);
    expect(validateDoc(next)).toMatchObject({ ok: true });
  });

  it("pastes text style but not text, and works on several layers", () => {
    const source = { ...text("s", {}, "Source"), size: 64, color: "#AA0000", align: "center" as const, font: { family: "Lora", weight: 700, style: "italic" as const } };
    const doc = docWith([source, text("a", {}, "Alpha"), text("b", {}, "Beta")]);
    const next = run(doc, planPasteStyle(doc, ["a", "b"], "design", styleOf(source)));
    for (const id of ["a", "b"]) expect(next.nodes[id]).toMatchObject({ size: 64, color: "#AA0000", align: "center", font: { family: "Lora", weight: 700 } });
    expect(next.nodes.a).toMatchObject({ content: "Alpha", maxChars: null });
  });

  it("pastes a frame's filters without touching its photo", () => {
    const source = { ...frame("s", {}), filters: { ...frame("x", {}).filters, brightness: 0.3, preset: "mono" } };
    const target = { ...frame("t", {}), placeholder: false, content: { assetId: "asset1", offsetX: 5, offsetY: 6, scale: 2 } };
    const doc = { ...docWith([source, target]), assets: { asset1: { id: "asset1", kind: "photo" as const, mime: "image/jpeg" as const, width: 10, height: 10 } } };
    const next = run(doc, planPasteStyle(doc, ["t"], "design", styleOf(source)));
    expect(next.nodes.t).toMatchObject({ filters: { brightness: 0.3, preset: "mono" }, content: target.content, placeholder: false });
  });

  it("skips layers of another type and says how many, singular and plural", () => {
    const doc = docWith([redRect, rect("a", {}), rect("b", {}), text("t1", {}), text("t2", {}), frame("f", {})]);
    const style = styleOf(redRect);
    const one = ok(planPasteStyle(doc, ["a", "t1"], "design", style));
    expect(one.notice).toBe("Style pasted to 1 layer. 1 layer of another kind was skipped.");
    const many = ok(planPasteStyle(doc, ["a", "b", "t1", "t2", "f"], "design", style));
    expect(many.notice).toBe("Style pasted to 2 layers. 3 layers of another kind were skipped.");
    const two = ok(planPasteStyle(doc, ["a", "b", "f"], "design", style));
    expect(two.notice).toBe("Style pasted to 2 layers. 1 layer of another kind was skipped.");
    const next = applyCommand(doc, many.command).doc;
    expect(next.nodes.t1).toBe(doc.nodes.t1);
  });

  it("has no notice when nothing is skipped, and keeps the selection", () => {
    const doc = docWith([redRect, rect("a", {})]);
    const plan = ok(planPasteStyle(doc, ["a"], "design", styleOf(redRect)));
    expect(plan.notice).toBeUndefined();
    expect(plan.select).toEqual(["a"]);
  });

  it("acts on a group, not its selected children", () => {
    const doc = docWith([{ ...group("src", {}, []), opacity: 0.3 }, group("g", {}, ["c"])], [rect("c", {})]);
    const next = run(doc, planPasteStyle(doc, ["g", "c"], "design", styleOf(doc.nodes.src!)));
    expect(next.nodes.g!.opacity).toBe(0.3);
    expect(next.nodes.c!.opacity).toBe(1);
  });

  it("refuses with the exact reasons", () => {
    const doc = docWith([redRect, text("t", {})]);
    expect(reason(planPasteStyle(doc, ["t"], "design", null))).toBe("Copy a style first.");
    expect(reason(planPasteStyle(doc, ["t"], "design", undefined))).toBe("Copy a style first.");
    expect(reason(planPasteStyle(doc, [], "design", styleOf(redRect)))).toBe("Select a layer first.");
    expect(reason(planPasteStyle(doc, ["t"], "design", styleOf(redRect)))).toBe("These layers are a different kind, so the style wasn't pasted.");
  });

  it("follows the lock policy: locked layers refuse, content-only layers take a style", () => {
    const doc = docWith([redRect, { ...rect("l", {}), lock: "locked" as const }, { ...rect("c", {}), lock: "content-only" as const }]);
    const style = styleOf(redRect);
    expect(reason(planPasteStyle(doc, ["l"], "design", style))).toBe("This layer is locked. Unlock it to change it.");
    expect(planPasteStyle(doc, ["c"], "design", style).ok).toBe(true);
    expect(planPasteStyle(doc, ["l"], "template", style).ok).toBe(true);
  });

  it("does not let the pasted layers share objects with the copied style", () => {
    const doc = docWith([redRect, rect("a", {}), rect("b", {})]);
    const style = styleOf(redRect);
    const next = run(doc, planPasteStyle(doc, ["a", "b"], "design", style));
    expect(next.nodes.a!).not.toBe(next.nodes.b!);
    expect((next.nodes.a as { stroke: object }).stroke).not.toBe((next.nodes.b as { stroke: object }).stroke);
    expect((next.nodes.a as { stroke: object }).stroke).not.toBe(style.fields.stroke);
  });
});
