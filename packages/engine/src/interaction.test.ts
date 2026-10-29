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

  it("snaps to guides when objects snapping is off, and to the artboard edge by default", () => {
    // Layer "a" spans x 150 to 250. Dragging it 30 px left puts its left edge at 120, 3 px from a guide at 123.
    const guided = setup();
    guided.core.setSnapOptions({ objects: false, guides: { x: [123], y: [] } });
    guided.ui.pointerDown(guided.p(200, 200));
    guided.ui.pointerMove(guided.p(170, 200));
    expect(guided.node("a").transform.x).toBe(173);
    expect(guided.core.getState().guides).toEqual([expect.objectContaining({ axis: "x", at: 123 })]);
    guided.ui.pointerUp(guided.p(170, 200));

    // Dragging it 147 px left puts its left edge at 3, next to the artboard edge (0): only default snapping takes it there.
    const off = setup();
    off.core.setSnapOptions({ objects: false, guides: { x: [], y: [] } });
    off.drag([200, 200], [53, 200]);
    expect(off.node("a").transform.x).toBe(53);
    const on = setup();
    on.drag([200, 200], [53, 200]);
    expect(on.node("a").transform.x).toBe(50);
  });

  it("refuses to move layout-locked layers and says why", () => {
    const { core, drag, node } = setup([{ ...rect("co", { x: 200, y: 200 }), lock: "content-only" }]);
    drag([200, 200], [300, 300]);
    expect(node("co").transform.x).toBe(200);
    expect(core.getState().notice).toMatch(/layout locked/i);
  });
});

describe("equal spacing", () => {
  // Boxes are 100 px wide. "left" spans 50-150 and "right" 350-450, a 200 px gap. "m" starts at 750-850 (centre 800).
  const row = () => setup([rect("left", { x: 100, y: 200 }), rect("right", { x: 400, y: 200 }), rect("m", { x: 800, y: 200 })]);

  it("snaps a layer to an equal gap while dragging, marks both gaps, and clears them on release", () => {
    const { core, ui, p, node } = row();
    ui.pointerDown(p(800, 200));
    // Centre 697 spans 647-747, 197 px from "right". Shifting 3 px right makes the gap 200, like the one between "left" and "right".
    ui.pointerMove(p(697, 200));
    expect(node("m").transform.x).toBe(700);
    expect(core.getState().spacing).toEqual([
      { axis: "x", from: 450, to: 650, at: 200 },
      { axis: "x", from: 150, to: 350, at: 200 },
    ]);
    ui.pointerUp(p(697, 200));
    expect(node("m").transform.x).toBe(700);
    expect(core.getState().spacing).toEqual([]);
  });

  it("does not snap to an equal gap or mark spacing when objects snapping is off", () => {
    const { core, ui, p, node } = row();
    core.setSnapOptions({ objects: false, guides: { x: [], y: [] } });
    ui.pointerDown(p(800, 200));
    ui.pointerMove(p(697, 200));
    expect(node("m").transform.x).toBe(697);
    expect(core.getState().spacing).toEqual([]);
  });

  it("clears spacing when the drag is cancelled", () => {
    const { core, ui, p, node } = row();
    ui.pointerDown(p(800, 200));
    ui.pointerMove(p(697, 200));
    expect(core.getState().spacing).not.toEqual([]);
    ui.cancel();
    expect(node("m").transform.x).toBe(800);
    expect(core.getState().spacing).toEqual([]);
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

describe("hand tool", () => {
  it("pans when a primary drag starts anywhere, including on a layer", () => {
    const { core, ui, drag, node } = setup();
    core.select(["a"]);
    ui.setTool("hand");
    drag([200, 200], [260, 230]);
    expect(core.getState().viewport).toMatchObject({ panX: 60, panY: 30 });
    expect(node("a").transform).toMatchObject({ x: 200, y: 200 });
    expect(core.getState().canUndo).toBe(false);
  });

  it("does not move the selected layer, select, or hover", () => {
    const { core, ui, p, drag } = setup();
    core.select(["a"]);
    ui.setTool("hand");
    drag([200, 200], [240, 240]);
    expect(core.getState().selection).toEqual(["a"]);
    ui.pointerMove(p(600, 600));
    expect(core.getState().hover).toBeNull();
  });

  it("does not select on click, or clear the selection on an empty click", () => {
    const { core, ui, p } = setup();
    ui.setTool("hand");
    ui.pointerDown(p(200, 200));
    ui.pointerUp(p(200, 200));
    expect(core.getState().selection).toEqual([]);
    core.select(["b"]);
    ui.pointerDown(p(900, 100));
    ui.pointerUp(p(900, 100));
    expect(core.getState().selection).toEqual(["b"]);
  });

  it("shows the grab cursor, and grabbing while panning", () => {
    const { ui, p } = setup();
    ui.setTool("hand");
    expect(ui.cursor()).toBe("grab");
    ui.pointerDown(p(200, 200));
    expect(ui.cursor()).toBe("grabbing");
    ui.pointerUp(p(200, 200));
    expect(ui.cursor()).toBe("grab");
  });

  it("keeps Space panning in select mode too", () => {
    const { core, ui, drag } = setup();
    ui.setSpace(true);
    drag([200, 200], [230, 200]);
    expect(core.getState().viewport).toMatchObject({ panX: 30, panY: 0 });
    ui.setSpace(false);
    expect(ui.tool()).toBe("select");
  });

  it("returns to select mode: clicks select and drags move again", () => {
    const { core, ui, p, drag, node } = setup();
    ui.setTool("hand");
    ui.setTool("select");
    ui.pointerDown(p(200, 200));
    ui.pointerUp(p(200, 200));
    expect(core.getState().selection).toEqual(["a"]);
    drag([200, 200], [233, 211]);
    expect(node("a").transform).toMatchObject({ x: 233, y: 211 });
  });

  it("round-trips the tool, publishes each change, and stays out of undo history", () => {
    const { core, ui } = setup();
    let published = 0;
    core.subscribe(() => published++);
    expect(ui.tool()).toBe("select");
    ui.setTool("hand");
    expect(ui.tool()).toBe("hand");
    expect(published).toBe(1);
    ui.setTool("hand");
    expect(published).toBe(1);
    ui.setTool("select");
    expect(ui.tool()).toBe("select");
    expect(published).toBe(2);
    expect(core.getState().canUndo).toBe(false);
    expect(core.doc.nodes.a!.transform).toMatchObject({ x: 200, y: 200 });
  });
});
