import { validateDoc, type Doc } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { EditorCore } from "./editor-core";
import { LAYOUT_LOCKED, LOCKED } from "./policy";
import { planResize, resizeDesign } from "./resize";
import type { Plan } from "./selection-utils";
import { docWith, group, rect, text } from "./test-docs";

const ok = (plan: Plan) => {
  if (!plan.ok) throw new Error(plan.reason);
  return plan;
};
const run = (doc: Doc, plan: Plan) => applyCommand(doc, ok(plan).command).doc;
const reason = (plan: Plan) => (plan.ok ? "" : plan.reason);

describe("planResize: scaling", () => {
  it("scales each top-level layer by the smaller ratio and keeps the layout centred", () => {
    const doc = docWith([rect("a", { x: 100, y: 100 })]);
    // Half size on both sides: the layer's centre moves to (100 - 500) * 0.5 + 250 = 50.
    const out = run(doc, planResize(doc, { width: 500, height: 500 }, "design", true));
    expect(out.artboard).toMatchObject({ width: 500, height: 500 });
    expect(out.nodes.a!.transform).toMatchObject({ x: 50, y: 50, scaleX: 0.5, scaleY: 0.5 });
  });

  it("uses the smaller ratio when the proportions change, so the content still fits", () => {
    const doc = docWith([rect("a", { x: 100, y: 100 })]);
    // Width doubles, height halves: the factor is 0.5. Centre (100, 100) goes to (800, 50).
    const out = run(doc, planResize(doc, { width: 2000, height: 500 }, "design", true));
    expect(out.nodes.a!.transform).toMatchObject({ x: 800, y: 50, scaleX: 0.5, scaleY: 0.5 });
  });

  it("moves content that sits at the middle of the old artboard to the middle of the new one", () => {
    const doc = docWith([rect("a", { x: 500, y: 500 })]);
    const out = run(doc, planResize(doc, { width: 2000, height: 1000 }, "design", true));
    expect(out.nodes.a!.transform).toMatchObject({ x: 1000, y: 500, scaleX: 1, scaleY: 1 });
  });

  it("keeps rotation and multiplies an existing scale", () => {
    const doc = docWith([rect("a", { x: 500, y: 500, rotation: 30, scaleX: 2, scaleY: 1 })]);
    const out = run(doc, planResize(doc, { width: 500, height: 500 }, "design", true));
    expect(out.nodes.a!.transform).toMatchObject({ x: 250, y: 250, rotation: 30, scaleX: 1, scaleY: 0.5 });
  });

  it("scales text with its layer through the transform", () => {
    const doc = docWith([text("t", { x: 600, y: 700 })]);
    const out = run(doc, planResize(doc, { width: 500, height: 500 }, "design", true));
    expect(out.nodes.t).toMatchObject({ type: "text", size: 32, transform: { scaleX: 0.5, scaleY: 0.5 } });
  });

  it("scales a group and leaves its children relative to it", () => {
    const doc = docWith([group("g", { x: 500, y: 500 }, ["a"])], [rect("a", { x: 10, y: -10 })]);
    const out = run(doc, planResize(doc, { width: 500, height: 500 }, "design", true));
    expect(out.nodes.g!.transform).toMatchObject({ x: 250, y: 250, scaleX: 0.5, scaleY: 0.5 });
    expect(out.nodes.a!.transform).toMatchObject({ x: 10, y: -10, scaleX: 1, scaleY: 1 });
  });

  it("keeps content as it is when scaling is off", () => {
    const doc = docWith([rect("a", { x: 100, y: 100 })]);
    const out = run(doc, planResize(doc, { width: 500, height: 500 }, "design", false));
    expect(out.artboard).toMatchObject({ width: 500, height: 500 });
    expect(out.nodes.a).toEqual(doc.nodes.a);
  });

  it("keeps the selection and one undo step through resizeDesign", () => {
    const core = new EditorCore(docWith([rect("a", { x: 100, y: 100 }), rect("b", { x: 800, y: 800 })]));
    const before = core.doc;
    core.select(["a"]);
    expect(resizeDesign(core, { width: 2000, height: 2000 }, true)).toBe(true);
    expect(core.doc.artboard.width).toBe(2000);
    expect(core.getState().selection).toEqual(["a"]);
    core.undo();
    expect(core.doc).toEqual(before);
    expect(core.getState().canUndo).toBe(false);
  });

  it("produces a valid document", () => {
    const doc = docWith([rect("a", { x: 100, y: 100, rotation: 45 }), text("t", { x: 300, y: 300 }), group("g", { x: 700, y: 700 }, ["b"])], [rect("b", { x: 5, y: 5 })]);
    for (const [size, scale] of [
      [{ width: 2000, height: 600 }, true],
      [{ width: 300, height: 4000 }, true],
      [{ width: 300, height: 4000 }, false],
    ] as const) {
      expect(validateDoc(run(doc, planResize(doc, size, "design", scale)), { kind: "design" }).ok).toBe(true);
    }
  });
});

describe("planResize: limits, no-op and policy", () => {
  it("refuses sizes outside the artboard limits, with the real limits in the message", () => {
    const doc = docWith([]);
    expect(reason(planResize(doc, { width: 15, height: 1000 }, "design", true))).toBe("Sizes must be between 16 and 8192 px.");
    expect(reason(planResize(doc, { width: 1000, height: 8193 }, "design", false))).toBe("Sizes must be between 16 and 8192 px.");
    expect(planResize(doc, { width: 16, height: 8192 }, "design", false).ok).toBe(true);
  });

  it("refuses sizes that are not whole pixels", () => {
    expect(reason(planResize(docWith([]), { width: 500.5, height: 500 }, "design", true))).toBe("Sizes must be whole pixels.");
    expect(reason(planResize(docWith([]), { width: Number.NaN, height: 500 }, "design", true))).toBe("Sizes must be whole pixels.");
  });

  it("refuses a resize to the size the design already has", () => {
    const doc = docWith([rect("a", { x: 100, y: 100 })]);
    expect(reason(planResize(doc, { width: 1000, height: 1000 }, "design", true))).toBe("That's already the size.");
    expect(reason(planResize(doc, { width: 1000, height: 1000 }, "design", false))).toBe("That's already the size.");
  });

  it("refuses a scale that would push a layer past the scale limit", () => {
    const doc = docWith([rect("a", { x: 500, y: 500, scaleX: 0.5, scaleY: 0.5 })]);
    // 0.5 times 16 / 1000 is 0.008, below the 0.01 minimum.
    expect(reason(planResize(doc, { width: 16, height: 16 }, "design", true))).toBe("Scaling the content that far would make a layer too large or too small.");
  });

  it("refuses to move a locked layer and says why", () => {
    const doc = docWith([{ ...rect("a", { x: 100, y: 100 }), lock: "locked" }]);
    expect(reason(planResize(doc, { width: 500, height: 500 }, "design", true))).toBe(LOCKED);
  });

  it("refuses to move a layer the template keeps in place, with the policy's reason", () => {
    const doc = docWith([{ ...rect("a", { x: 100, y: 100 }), lock: "content-only" }]);
    expect(reason(planResize(doc, { width: 500, height: 500 }, "design", true))).toBe(LAYOUT_LOCKED);
  });

  it("refuses the size change itself when any layer is locked, even without scaling", () => {
    const doc = docWith([{ ...rect("a", { x: 100, y: 100 }), lock: "content-only" }]);
    expect(reason(planResize(doc, { width: 500, height: 500 }, "design", false))).toMatch(/Locked layers keep this design's size/);
  });

  it("does not apply the lock policy in Author Mode", () => {
    const doc = docWith([{ ...rect("a", { x: 100, y: 100 }), lock: "content-only" }]);
    expect(planResize(doc, { width: 500, height: 500 }, "template", true).ok).toBe(true);
  });
});
