import { LIMITS, validateDoc, type GroupNode, type ShapeNode } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { EditorCore } from "./editor-core";
import { insertGrid, type GridOptions } from "./grid";
import { docWith, rect } from "./test-docs";

const GRID: GridOptions = { rows: 2, cols: 2, cellSize: 100, gap: 10, fill: "#C7C7CC", stroke: null };
const TABLE: GridOptions = { rows: 3, cols: 4, cellSize: 100, gap: 0, fill: null, stroke: { color: "#1C1C1E", width: 4 } };

/** The group that was just added on top, and its cells in order. */
function addedGroup(core: EditorCore) {
  const doc = core.getState().doc;
  const group = doc.nodes[doc.root.at(-1)!] as GroupNode;
  const cells = group.children.map((id) => doc.nodes[id] as ShapeNode);
  return { doc, group, cells };
}

describe("insertGrid", () => {
  it("adds one group with rows times cols cells, as one layer on top", () => {
    const core = new EditorCore(docWith([rect("a", {})]));
    expect(insertGrid(core, { ...TABLE, rows: 3, cols: 4 })).toBe(true);
    const { doc, group, cells } = addedGroup(core);
    expect(doc.root).toEqual(["a", group.id]);
    expect(Object.keys(doc.nodes)).toHaveLength(2 + 12);
    expect(cells).toHaveLength(12);
    expect(cells.every((c) => c.type === "shape" && c.geometry.kind === "rect")).toBe(true);
  });

  it("names a grid Grid, and a gap-0 stroked grid Table", () => {
    const grid = new EditorCore(docWith([]));
    insertGrid(grid, GRID);
    expect(addedGroup(grid).group.name).toBe("Grid");

    const table = new EditorCore(docWith([]));
    insertGrid(table, TABLE);
    expect(addedGroup(table).group.name).toBe("Table");

    const gapped = new EditorCore(docWith([]));
    insertGrid(gapped, { ...TABLE, gap: 4 });
    expect(addedGroup(gapped).group.name).toBe("Grid");
  });

  it("centres the group on the artboard with an unrotated, unscaled transform and places cells relative to its centre", () => {
    const core = new EditorCore(docWith([]));
    expect(insertGrid(core, GRID)).toBe(true);
    const { group, cells } = addedGroup(core);
    expect(group.transform).toEqual({ x: 500, y: 500, rotation: 0, scaleX: 1, scaleY: 1 });
    expect(group).toMatchObject({ width: 210, height: 210 });
    // 2 by 2 cells of 100 with a gap of 10: the centres sit at -55 and 55 either side of the group centre.
    expect(cells.map((c) => [c.transform.x, c.transform.y])).toEqual([
      [-55, -55],
      [55, -55],
      [-55, 55],
      [55, 55],
    ]);
    expect(cells[0]).toMatchObject({ width: 100, height: 100, fill: { type: "solid", color: "#C7C7CC" }, stroke: null });
  });

  it("gives every cell a stroke and no fill for a table", () => {
    const core = new EditorCore(docWith([]));
    insertGrid(core, TABLE);
    const { cells } = addedGroup(core);
    expect(cells[0]).toMatchObject({ fill: null, stroke: { color: "#1C1C1E", width: 4 } });
    // Gap 0 on 3 by 4 cells of 100: the first centre is at -150 across and -100 down.
    expect(cells[0]!.transform).toMatchObject({ x: -150, y: -100 });
    expect(cells.at(-1)!.transform).toMatchObject({ x: 150, y: 100 });
  });

  it("selects the group afterwards", () => {
    const core = new EditorCore(docWith([]));
    insertGrid(core, GRID);
    const { group } = addedGroup(core);
    expect(core.getState().selection).toEqual([group.id]);
  });

  it("is one undo step", () => {
    const core = new EditorCore(docWith([rect("a", {})]));
    insertGrid(core, TABLE);
    expect(Object.keys(core.getState().doc.nodes)).toHaveLength(14);
    core.undo();
    const { doc } = core.getState();
    expect(doc.root).toEqual(["a"]);
    expect(Object.keys(doc.nodes)).toEqual(["a"]);
  });

  it("produces documents that pass validateDoc, filled and table", () => {
    for (const o of [GRID, TABLE, { ...GRID, cellSize: 120, gap: 12, rows: 4, cols: 4 }]) {
      const core = new EditorCore(docWith([]));
      expect(insertGrid(core, o)).toBe(true);
      expect(validateDoc(core.getState().doc), JSON.stringify(o)).toMatchObject({ ok: true });
    }
  });

  it("refuses when the design has no room for every cell and the group", () => {
    const many = Array.from({ length: LIMITS.designNodes - 4 }, (_, i) => rect(`r${i}`, {}));
    const core = new EditorCore(docWith(many));
    // 496 layers + 4 cells + 1 group = 501, one over the limit.
    expect(insertGrid(core, GRID)).toBe(false);
    expect(core.getState().notice).toMatch(/up to 500 layers/);
    expect(core.getState().doc.root).toHaveLength(LIMITS.designNodes - 4);
  });

  it("fits exactly up to the layer limit", () => {
    const many = Array.from({ length: LIMITS.designNodes - 5 }, (_, i) => rect(`r${i}`, {}));
    const core = new EditorCore(docWith(many));
    // 495 layers + 4 cells + 1 group = 500.
    expect(insertGrid(core, GRID)).toBe(true);
    expect(Object.keys(core.getState().doc.nodes)).toHaveLength(LIMITS.designNodes);
  });

  it("refuses sizes the schema would not take, with a notice and no change", () => {
    const bad: Array<[string, Partial<GridOptions>]> = [
      ["zero rows", { rows: 0 }],
      ["13 rows", { rows: 13 }],
      ["fractional columns", { cols: 2.5 }],
      ["NaN cell size", { cellSize: Number.NaN }],
      ["zero cell size", { cellSize: 0 }],
      ["cell above the artboard limit", { cellSize: LIMITS.artboardMax + 1 }],
      ["negative gap", { gap: -1 }],
      ["infinite gap", { gap: Number.POSITIVE_INFINITY }],
      ["grid wider than the coordinate limit", { rows: 12, cols: 12, cellSize: LIMITS.artboardMax, gap: LIMITS.artboardMax }],
      ["bad fill colour", { fill: "red" }],
      ["bad stroke colour", { stroke: { color: "#12", width: 2 } }],
      ["stroke too thick", { stroke: { color: "#000000", width: LIMITS.strokeWidthMax + 1 } }],
    ];
    for (const [label, patch] of bad) {
      const core = new EditorCore(docWith([]));
      expect(insertGrid(core, { ...GRID, ...patch }), label).toBe(false);
      expect(core.getState().notice, label).toBeTruthy();
      expect(core.getState().doc.root, label).toEqual([]);
    }
  });
});
