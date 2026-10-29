import { LIMITS, validateDoc, type GroupNode } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { DUPLICATE_OFFSET, planDuplicate } from "./clipboard";
import type { Plan } from "./selection-utils";
import { docWith, group, rect } from "./test-docs";

const ok = (plan: Plan) => {
  if (!plan.ok) throw new Error(plan.reason);
  return plan;
};

describe("planDuplicate", () => {
  it("copies a layer under a new id, offset, on top, and selects the copy", () => {
    const doc = docWith([rect("a", { x: 100, y: 100 }), rect("b", { x: 300, y: 300 })]);
    const plan = ok(planDuplicate(doc, ["a"], "design"));
    const next = applyCommand(doc, plan.command).doc;
    const copy = plan.select[0]!;
    expect(copy).not.toBe("a");
    expect(next.root).toEqual(["a", "b", copy]);
    expect(next.nodes[copy]!.transform).toMatchObject({ x: 100 + DUPLICATE_OFFSET, y: 100 + DUPLICATE_OFFSET });
    expect(validateDoc(next)).toMatchObject({ ok: true });
  });

  it("is undone by its inverse in one step", () => {
    const doc = docWith([rect("a", {})]);
    const { doc: next, inverse } = applyCommand(doc, ok(planDuplicate(doc, ["a"], "design")).command);
    expect(applyCommand(next, inverse).doc).toEqual(doc);
  });

  it("copies a group's children under new ids and keeps them inside the copy", () => {
    const doc = docWith([group("g", { x: 500, y: 500 }, ["c1", "c2"])], [rect("c1", { x: -50 }), rect("c2", { x: 50 })]);
    const plan = ok(planDuplicate(doc, ["g"], "design"));
    const next = applyCommand(doc, plan.command).doc;
    const copy = next.nodes[plan.select[0]!] as GroupNode;
    expect(copy.type).toBe("group");
    expect(copy.children).toHaveLength(2);
    for (const child of copy.children) expect(["c1", "c2"]).not.toContain(child);
    expect(Object.keys(next.nodes)).toHaveLength(6);
    expect(validateDoc(next)).toMatchObject({ ok: true });
  });

  it("copies only the group when a group and one of its children are both selected", () => {
    const doc = docWith([group("g", { x: 500, y: 500 }, ["c1", "c2"])], [rect("c1", { x: -50 }), rect("c2", { x: 50 })]);
    const plan = ok(planDuplicate(doc, ["g", "c1"], "design"));
    expect(plan.select).toHaveLength(1);
    expect(Object.keys(applyCommand(doc, plan.command).doc.nodes)).toHaveLength(6);
  });

  it("gives copies free locks in a design and keeps the locks in a template", () => {
    const doc = docWith([{ ...rect("a", {}), lock: "locked" as const }]);
    const inDesign = ok(planDuplicate(doc, ["a"], "design"));
    const inTemplate = ok(planDuplicate(doc, ["a"], "template"));
    expect(applyCommand(doc, inDesign.command).doc.nodes[inDesign.select[0]!]!.lock).toBe("free");
    expect(applyCommand(doc, inTemplate.command).doc.nodes[inTemplate.select[0]!]!.lock).toBe("locked");
  });

  it("refuses with a clear message when nothing is selected", () => {
    expect(planDuplicate(docWith([rect("a", {})]), [], "design")).toEqual({ ok: false, reason: "Select a layer to duplicate." });
  });

  it("refuses at the layer cap instead of building an invalid document", () => {
    const doc = docWith(Array.from({ length: LIMITS.designNodes }, (_, i) => rect(`r${i}`, {})));
    const plan = planDuplicate(doc, ["r0"], "design");
    expect(plan.ok).toBe(false);
    expect(plan.ok ? "" : plan.reason).toMatch(/up to 500 layers/);
  });
});
