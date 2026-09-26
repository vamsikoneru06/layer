import { describe, expect, it } from "vitest";
import { GUIDE_COLOR, renderOverlay, type OverlayState } from "./overlay";
import { recordingContext } from "./recording-ctx";
import { docWith, rect } from "./test-docs";

const doc = docWith([rect("a", { x: 200, y: 200 }), rect("b", { x: 600, y: 600 })]);
const view = { zoom: 1, panX: 0, panY: 0 };
const state = (o: Partial<OverlayState> = {}): OverlayState => ({ selection: [], hover: null, guides: [], marquee: null, layoutLocked: false, dragging: false, ...o });

describe("renderOverlay", () => {
  it("draws eight resize handles and a rotate handle for a free selection", () => {
    const { ctx, calls } = recordingContext();
    renderOverlay(ctx, doc, view, 1, state({ selection: ["a"] }));
    expect(calls.filter((c) => c.op === "fillRect")).toHaveLength(8);
    expect(calls.filter((c) => c.op === "arc")).toHaveLength(1);
  });

  it("uses a dashed outline and no handles for layout-locked layers, and hides handles while dragging", () => {
    const locked = recordingContext();
    renderOverlay(locked.ctx, doc, view, 1, state({ selection: ["a"], layoutLocked: true }));
    expect(locked.calls).toContainEqual({ op: "setLineDash", args: [[5, 4]] });
    expect(locked.calls.filter((c) => c.op === "fillRect")).toHaveLength(0);

    const dragging = recordingContext();
    renderOverlay(dragging.ctx, doc, view, 1, state({ selection: ["a"], dragging: true }));
    expect(dragging.calls.filter((c) => c.op === "fillRect")).toHaveLength(0);
  });

  it("draws snapping guides in pink over a white halo", () => {
    const { ctx, calls } = recordingContext();
    renderOverlay(ctx, doc, view, 2, state({ guides: [{ axis: "x", at: 500, from: 0, to: 1000 }] }));
    const strokes = calls.filter((c) => c.op === "set:strokeStyle").map((c) => c.args[0]);
    expect(strokes).toEqual(["#FFFFFF", GUIDE_COLOR]);
    expect(calls).toContainEqual({ op: "setTransform", args: [2, 0, 0, 2, 0, 0] });
  });
});
