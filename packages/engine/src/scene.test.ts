import { describe, expect, it } from "vitest";
import { apply } from "./math";
import { drawOrder, parentOf, topLevelOf, worldMatrix } from "./scene";
import { docWith, group, rect } from "./test-docs";

describe("scene", () => {
  const doc = docWith(
    [rect("bg", { x: 500, y: 500 }), group("g", { x: 300, y: 300, rotation: 90 }, ["a", "b"]), rect("top", { x: 800, y: 800 })],
    [rect("a", { x: 10, y: 0 }), rect("b", { x: 0, y: 0 })],
  );

  it("paints bottom to top with group children in place of the group", () => {
    expect(drawOrder(doc)).toEqual(["bg", "a", "b", "top"]);
  });

  it("places group children relative to the group centre", () => {
    // Child "a" sits 10 px right of the group centre; the group is rotated 90°, so it lands 10 px below.
    const p = apply(worldMatrix(doc, "a"), { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(300);
    expect(p.y).toBeCloseTo(310);
  });

  it("knows each child's parent and the top-level ancestor", () => {
    expect(parentOf(doc, "a")).toBe("g");
    expect(parentOf(doc, "bg")).toBeNull();
    expect(topLevelOf(doc, "b")).toBe("g");
    expect(topLevelOf(doc, "top")).toBe("top");
  });

  it("skips hidden layers and everything inside hidden groups", () => {
    const hidden = { ...doc, nodes: { ...doc.nodes, g: { ...doc.nodes.g!, visible: false }, top: { ...doc.nodes.top!, visible: false } } };
    expect(drawOrder(hidden)).toEqual(["bg"]);
  });
});
