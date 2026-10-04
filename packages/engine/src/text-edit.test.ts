import { describe, expect, it } from "vitest";
import { apply } from "./math";
import { docWith, rect, text } from "./test-docs";
import { textEditBox } from "./text-edit";

// 10 px per character, so layouts are predictable.
const measure = (s: string) => s.length * 10;

describe("textEditBox", () => {
  it("maps the box's top-left through the layer and the viewport", () => {
    const doc = docWith([text("t", { x: 500, y: 300 }, "Hi", 300, 60)]);
    const box = textEditBox(doc, "t", { zoom: 0.5, panX: 20, panY: 10 }, measure)!;
    // Layer top-left in artboard units is (350, 270); on screen ×0.5 + pan.
    expect(apply(box.matrix, { x: 0, y: 0 })).toEqual({ x: 195, y: 145 });
    expect(apply(box.matrix, { x: 300, y: 60 })).toEqual({ x: 345, y: 175 });
    expect(box).toMatchObject({ width: 300, height: 60, fontSize: 32 });
    // One 38.4 px line centred in 60 px.
    expect(box.paddingTop).toBeCloseTo(10.8);
  });

  it("grows to fit overflowing text, keeping it centred on the layer", () => {
    const doc = docWith([text("t", { x: 0, y: 0 }, "a\nb\nc", 300, 60)]);
    const box = textEditBox(doc, "t", { zoom: 1, panX: 0, panY: 0 }, measure)!;
    expect(box.height).toBeCloseTo(3 * 38.4);
    expect(box.paddingTop).toBe(0);
    expect(apply(box.matrix, { x: 0, y: 0 }).y).toBeCloseTo(-57.6);
  });

  it("is null for layers that aren't text", () => {
    expect(textEditBox(docWith([rect("r", {})]), "r", { zoom: 1, panX: 0, panY: 0 }, measure)).toBeNull();
  });
});
