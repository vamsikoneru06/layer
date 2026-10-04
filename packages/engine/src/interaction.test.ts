import type { Node } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { EditorCore } from "./editor-core";
import { createInteraction, type PointerInput } from "./interaction";
import { docWith, group, rect } from "./test-docs";

/** Viewport zoom 1, pan 0: screen coordinates equal artboard coordinates. */
function setup(nodes: Node[] = [rect("a", { x: 200, y: 200 }), rect("b", { x: 600, y: 600 })], extra: Node[] = []) {
  const core = new EditorCore(docWith(nodes, extra));
  const ui = createInteraction(core);
  const p = (x: number, y: number, o: Partial<PointerInput> = {}): PointerInput => ({ x, y, button: 0, shift: false, alt: false, ...o });
  const drag = (from: [number, number], to: [number, number], o: Partial<PointerInput> = {}) => {
    ui.pointerDown(p(...from, o));
    for (let i = 1; i <= 4; i++) ui.pointerMove(p(from[0] + ((to[0] - from[0]) * i) / 4, from[1] + ((to[1] - from[1]) * i) / 4, o));
    ui.pointerUp(p(...to, o));
  };
  return { core, ui, p, drag, node: (id: string) => core.getState().doc.nodes[id]! };
}

describe("selection", () => {
  it("selects the top-level layer under the pointer and clears on empty canvas", () => {
    const { core, ui, p } = setup([rect("a", { x: 200, y: 200 }), group("g", { x: 600, y: 600 }, ["c"])], [rect("c", {})]);
    ui.pointerDown(p(610, 600));
    ui.pointerUp(p(610, 600));
    expect(core.getState().selection).toEqual(["g"]);
    ui.pointerDown(p(900, 100));
    ui.pointerUp(p(900, 100));
    expect(core.getState().selection).toEqual([]);
  });

  it("toggles layers in and out of the selection with Shift", () => {
    const { core, ui, p } = setup();
    for (const [x, y] of [[200, 200], [600, 600], [200, 200]] as const) {
      ui.pointerDown(p(x, y, { shift: true }));
      ui.pointerUp(p(x, y, { shift: true }));
    }
    expect(core.getState().selection).toEqual(["b"]);
  });

  it("selects with a marquee", () => {
    const { core, drag } = setup();
    drag([50, 50], [700, 300]);
    expect(core.getState().selection).toEqual(["a"]);
    expect(core.getState().marquee).toBeNull();
  });

  it("tracks the hovered layer", () => {
    const { core, ui, p } = setup();
    ui.pointerMove(p(600, 600));
    expect(core.getState().hover).toBe("b");
  });
});

describe("moving", () => {
  it("moves the selection as one undo step", () => {
    const { core, drag, node } = setup();
    drag([200, 200], [233, 211]);
    expect(node("a").transform).toMatchObject({ x: 233, y: 211 });
    core.undo();
    expect(node("a").transform).toMatchObject({ x: 200, y: 200 });
  });

  it("ignores tiny jitters below the drag threshold", () => {
    const { core, drag, node } = setup();
    drag([200, 200], [201, 201]);
    expect(node("a").transform.x).toBe(200);
    expect(core.getState().canUndo).toBe(false);
  });

  it("snaps to other layers and shows a guide while dragging", () => {
    const { core, ui, p, node } = setup();
    ui.pointerDown(p(200, 200));
    ui.pointerMove(p(400, 300));
    ui.pointerMove(p(597, 300)); // centre x 597 → snaps to b's centre 600
    expect(node("a").transform.x).toBe(600);
    expect(core.getState().guides.length).toBeGreaterThan(0);
    ui.pointerUp(p(597, 300));
    expect(core.getState().guides).toEqual([]);
  });

  it("refuses to move layout-locked layers and says why", () => {
    const { core, drag, node } = setup([{ ...rect("co", { x: 200, y: 200 }), lock: "content-only" }]);
    drag([200, 200], [300, 300]);
    expect(node("co").transform.x).toBe(200);
    expect(core.getState().notice).toMatch(/layout locked/i);
  });
});

describe("resizing and rotating", () => {
  it("resizes from a corner keeping the opposite corner fixed", () => {
    const { ui, p, drag, node } = setup();
    ui.pointerDown(p(200, 200));
    ui.pointerUp(p(200, 200));
    // a spans 150..250; drag the se corner from (250, 250) to (300, 270).
    drag([250, 250], [300, 270]);
    expect(node("a")).toMatchObject({ width: 150, height: 120, transform: { x: 225, y: 210 } });
  });

  it("keeps the aspect ratio with Shift and resizes about the centre with Alt", () => {
    const shifted = setup();
    shifted.ui.pointerDown(shifted.p(200, 200));
    shifted.ui.pointerUp(shifted.p(200, 200));
    shifted.drag([250, 250], [300, 270], { shift: true });
    expect(shifted.node("a")).toMatchObject({ width: 150, height: 150 });

    const alt = setup();
    alt.ui.pointerDown(alt.p(200, 200));
    alt.ui.pointerUp(alt.p(200, 200));
    alt.drag([250, 200], [270, 200], { alt: true });
    expect(alt.node("a")).toMatchObject({ width: 140, height: 100, transform: { x: 200, y: 200 } });
  });

  it("resizes a rotated layer along its own axes", () => {
    const { ui, p, drag, node } = setup([rect("r", { x: 500, y: 500, rotation: 90 }, 200, 100)]);
    ui.pointerDown(p(500, 500));
    ui.pointerUp(p(500, 500));
    // Rotated 90°: the node's "e" edge points down, at (500, 600). Dragging it 40 px further down widens it by 40.
    drag([500, 600], [500, 640]);
    expect(node("r").width).toBeCloseTo(240);
    expect(node("r").transform.y).toBeCloseTo(520);
  });

  it("rotates about the centre, snapping to 15° with Shift", () => {
    const { ui, p, drag, node } = setup();
    ui.pointerDown(p(200, 200));
    ui.pointerUp(p(200, 200));
    // Rotate handle sits 24 px above the top edge: (200, 126). Drag it to the right of the centre.
    drag([200, 126], [300, 205], { shift: true });
    expect(node("a").transform.rotation).toBe(90);
  });
});

describe("viewport", () => {
  it("pans with the middle button and zooms about the pointer", () => {
    const { core, ui, p } = setup();
    ui.pointerDown(p(100, 100, { button: 1 }));
    ui.pointerMove(p(150, 130, { button: 1 }));
    ui.pointerUp(p(150, 130, { button: 1 }));
    expect(core.getState().viewport).toMatchObject({ panX: 50, panY: 30 });
    ui.wheel({ x: 100, y: 100, deltaX: 0, deltaY: -100, zoom: true });
    expect(core.getState().viewport.zoom).toBeGreaterThan(1);
  });
});
