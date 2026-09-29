import { validateDoc, type Doc } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { apply, matricesClose } from "./math";
import { worldMatrix } from "./scene";
import type { Plan } from "./selection-utils";
import { planGroup, planUngroup } from "./structure";
import { docWith, group, rect } from "./test-docs";

const ok = (plan: Plan) => {
  if (!plan.ok) throw new Error(plan.reason);
  return plan;
};
const run = (doc: Doc, plan: Plan) => applyCommand(doc, ok(plan).command);
const reason = (plan: Plan) => (plan.ok ? "" : plan.reason);
const centre = (doc: Doc, id: string) => apply(worldMatrix(doc, id), { x: 0, y: 0 });

describe("planGroup", () => {
  it("groups two layers around their combined centre without moving them on screen", () => {
    const doc = docWith([rect("a", { x: 100, y: 100 }), rect("b", { x: 300, y: 300 }), rect("c", { x: 700 })]);
    const plan = ok(planGroup(doc, ["a", "b"], "design"));
    const next = applyCommand(doc, plan.command).doc;
    const g = next.nodes[plan.select[0]!]!;
    expect(g).toMatchObject({ type: "group", children: ["a", "b"], transform: { x: 200, y: 200 }, width: 300, height: 300 });
    expect(next.root).toEqual([g.id, "c"]);
    for (const id of ["a", "b", "c"]) expect(matricesClose(worldMatrix(next, id), worldMatrix(doc, id))).toBe(true);
    expect(validateDoc(next)).toMatchObject({ ok: true });
  });

  it("keeps rotated and scaled members exactly where they were (Review Focus 2)", () => {
    const doc = docWith([rect("a", { x: 100, y: 100, rotation: 30 }), { ...rect("b", { x: 300, y: 250, rotation: -70, scaleX: -1.5, scaleY: 2 }), width: 80 }]);
    const next = run(doc, planGroup(doc, ["a", "b"], "design")).doc;
    for (const id of ["a", "b"]) expect(matricesClose(worldMatrix(next, id), worldMatrix(doc, id))).toBe(true);
    expect(validateDoc(next)).toMatchObject({ ok: true });
  });

  it("puts the group where the topmost member was and keeps stacking order", () => {
    const doc = docWith([rect("a", {}), rect("b", {}), rect("c", {}), rect("d", {})]);
    const plan = ok(planGroup(doc, ["c", "a"], "design"));
    const next = applyCommand(doc, plan.command).doc;
    expect(next.root).toEqual(["b", plan.select[0], "d"]);
    expect((next.nodes[plan.select[0]!] as { children: string[] }).children).toEqual(["a", "c"]);
  });

  it("is undone by its inverse in one step", () => {
    const doc = docWith([rect("a", {}), rect("b", { x: 50 })]);
    const { doc: next, inverse } = run(doc, planGroup(doc, ["a", "b"], "design"));
    expect(applyCommand(next, inverse).doc).toEqual(doc);
  });

  it("needs two layers at the same level", () => {
    const doc = docWith([rect("a", {}), group("g", { x: 500, y: 500 }, ["c"])], [rect("c", {})]);
    expect(reason(planGroup(doc, ["a"], "design"))).toMatch(/two or more/);
    expect(reason(planGroup(doc, ["a", "c"], "design"))).toMatch(/same level/);
  });

  it("refuses locked layers in a design (Review Focus 4) but not in Author Mode", () => {
    const doc = docWith([{ ...rect("a", {}), lock: "locked" as const }, rect("b", { x: 50 })]);
    expect(reason(planGroup(doc, ["a", "b"], "design"))).toMatch(/locked/);
    expect(planGroup(doc, ["a", "b"], "template").ok).toBe(true);
  });
});

describe("planUngroup", () => {
  const rotated = () =>
    docWith(
      [{ ...group("g", { x: 500, y: 500, rotation: 90, scaleX: 2, scaleY: 2 }, ["c"]), opacity: 0.5 }],
      [{ ...rect("c", { x: 50, rotation: 10 }), opacity: 0.5 }],
    );

  it("lifts children out without moving them on screen, even in a rotated, scaled group (Review Focus 2)", () => {
    const doc = rotated();
    const plan = ok(planUngroup(doc, ["g"], "design"));
    const next = applyCommand(doc, plan.command).doc;
    expect(next.root).toEqual(["c"]);
    expect(next.nodes.g).toBeUndefined();
    expect(matricesClose(worldMatrix(next, "c"), worldMatrix(doc, "c"))).toBe(true);
    expect(centre(next, "c").x).toBeCloseTo(centre(doc, "c").x);
    expect(plan.select).toEqual(["c"]);
    expect(validateDoc(next)).toMatchObject({ ok: true });
  });

  it("bakes the group's opacity and visibility into its children", () => {
    const doc = rotated();
    const next = run(doc, planUngroup(doc, ["g"], "design")).doc;
    expect(next.nodes.c!.opacity).toBeCloseTo(0.25);
    const hidden = docWith([{ ...group("g", { x: 500, y: 500 }, ["c"]), visible: false }], [rect("c", {})]);
    expect(run(hidden, planUngroup(hidden, ["g"], "design")).doc.nodes.c!.visible).toBe(false);
  });

  it("refuses when a rotated child in a stretched group could not be drawn the same (Review Focus 2)", () => {
    const doc = docWith([group("g", { x: 500, y: 500, scaleX: 2, scaleY: 1 }, ["c"])], [rect("c", { rotation: 45 })]);
    expect(reason(planUngroup(doc, ["g"], "design"))).toMatch(/stretched/);
  });

  it("puts children where their group was, for several groups at once", () => {
    const doc = docWith(
      [rect("x", {}), group("g1", { x: 200, y: 200 }, ["a1", "a2"]), rect("y", {}), group("g2", { x: 600, y: 600 }, ["b1", "b2"])],
      [rect("a1", { x: -20 }), rect("a2", { x: 20 }), rect("b1", { x: -20 }), rect("b2", { x: 20 })],
    );
    const plan = ok(planUngroup(doc, ["g1", "g2"], "design"));
    expect(applyCommand(doc, plan.command).doc.root).toEqual(["x", "a1", "a2", "y", "b1", "b2"]);
    expect(plan.select.sort()).toEqual(["a1", "a2", "b1", "b2"]);
  });

  it("is undone by its inverse in one step", () => {
    const doc = rotated();
    const { doc: next, inverse } = run(doc, planUngroup(doc, ["g"], "design"));
    expect(applyCommand(next, inverse).doc).toEqual(doc);
  });

  it("needs a group, and refuses a locked group in a design", () => {
    const plain = docWith([rect("a", {})]);
    expect(reason(planUngroup(plain, ["a"], "design"))).toMatch(/Select a group/);
    const locked = docWith([{ ...group("g", { x: 500, y: 500 }, ["c"]), lock: "locked" as const }], [rect("c", {})]);
    expect(reason(planUngroup(locked, ["g"], "design"))).toMatch(/locked/);
  });
});
