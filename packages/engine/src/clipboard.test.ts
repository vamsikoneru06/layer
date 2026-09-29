import { LIMITS, type Doc, type GroupNode } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { CLIPBOARD_PREFIX, DUPLICATE_OFFSET, planPaste, serializeSelection } from "./clipboard";
import type { Plan } from "./selection-utils";
import { docWith, frame, group, rect } from "./test-docs";

const ok = (plan: Plan) => {
  if (!plan.ok) throw new Error(plan.reason);
  return plan;
};
const reason = (plan: Plan) => (plan.ok ? "" : plan.reason);
const NOTHING = "Nothing to paste.";
const photo = (id: string) => ({ id, kind: "photo" as const, mime: "image/jpeg" as const, width: 100, height: 100 });
const withPhoto = (): Doc => {
  const doc = docWith([]);
  doc.assets.p1 = photo("p1");
  return doc;
};
const photoFrame = (id: string, assetId: string) => ({ ...frame(id, {}), content: { assetId, offsetX: 0, offsetY: 0, scale: 1 } });
const payload = (nodes: unknown[], roots: string[], v = 1) => `${CLIPBOARD_PREFIX}${JSON.stringify({ v, roots, nodes })}`;

describe("serializeSelection", () => {
  it("returns null when nothing is selected", () => {
    expect(serializeSelection(docWith([rect("a", {})]), [])).toBeNull();
  });

  it("starts with the prefix and carries only top-level selected layers with their descendants", () => {
    const doc = docWith([group("g", { x: 500, y: 500 }, ["c"]), rect("b", {})], [rect("c", {})]);
    const text = serializeSelection(doc, ["g", "c"])!;
    expect(text.startsWith(CLIPBOARD_PREFIX)).toBe(true);
    const parsed = JSON.parse(text.slice(CLIPBOARD_PREFIX.length));
    expect(parsed.roots).toEqual(["g"]);
    expect(parsed.nodes.map((n: { id: string }) => n.id)).toEqual(["g", "c"]);
  });
});

describe("planPaste", () => {
  it("pastes a copied group into another design under new ids, offset, on top", () => {
    const source = docWith([group("g", { x: 500, y: 500 }, ["c1", "c2"])], [rect("c1", { x: -50 }), rect("c2", { x: 50 })]);
    const target = docWith([rect("existing", {})]);
    const plan = ok(planPaste(target, serializeSelection(source, ["g"])!, "design"));
    const next = applyCommand(target, plan.command).doc;
    const pasted = next.nodes[plan.select[0]!] as GroupNode;
    expect(next.root).toEqual(["existing", pasted.id]);
    expect(pasted.transform).toMatchObject({ x: 500 + DUPLICATE_OFFSET, y: 500 + DUPLICATE_OFFSET });
    expect(pasted.children.every((id) => !["c1", "c2", "g"].includes(id))).toBe(true);
    expect(Object.keys(next.nodes)).toHaveLength(4);
  });

  it("refuses text that is not a VASH payload (Review Focus 1)", () => {
    const doc = docWith([]);
    const bad = ["", "hello", "vash:{not json", `${CLIPBOARD_PREFIX}null`, `${CLIPBOARD_PREFIX}[]`, payload([], [], 2), payload([], []), `${CLIPBOARD_PREFIX}${"x".repeat(LIMITS.docBytes)}`];
    for (const text of bad) expect(planPaste(doc, text, "design"), text.slice(0, 20)).toEqual({ ok: false, reason: NOTHING });
  });

  it("refuses duplicate ids, missing roots and a group that contains itself (Review Focus 1)", () => {
    const doc = docWith([]);
    expect(reason(planPaste(doc, payload([rect("a", {}), rect("a", {})], ["a"]), "design"))).toBe(NOTHING);
    expect(reason(planPaste(doc, payload([rect("a", {})], ["nope"]), "design"))).toBe(NOTHING);
    expect(reason(planPaste(doc, payload([group("g", {}, ["g"])], ["g"]), "design"))).toBe(NOTHING);
  });

  it("refuses a layer shared by several groups instead of expanding it once per path", () => {
    const doc = docWith([]);
    const nodes: unknown[] = [rect("leaf", {})];
    for (let i = 0; i < 40; i++) nodes.push(group(`g${i}`, {}, i === 0 ? ["leaf", "leaf"] : [`g${i - 1}`, `g${i - 1}`]));
    expect(reason(planPaste(doc, payload(nodes, ["g39"]), "design"))).toBe(NOTHING);
    expect(reason(planPaste(doc, payload([rect("a", {})], ["a", "a"]), "design"))).toBe(NOTHING);
  });

  it("refuses a very deep or very large payload instead of overflowing the stack", () => {
    const doc = docWith([]);
    const chain: unknown[] = [rect("leaf", {})];
    for (let i = 0; i < 3000; i++) chain.push(group(`g${i}`, {}, [i === 0 ? "leaf" : `g${i - 1}`]));
    const text = payload(chain, ["g2999"]);
    expect(() => planPaste(doc, text, "design")).not.toThrow();
    expect(planPaste(doc, text, "design").ok).toBe(false);
  });

  it("still pastes a payload well under the layer cap", () => {
    const rects = Array.from({ length: 50 }, (_, i) => rect(`r${i}`, {}));
    const plan = ok(planPaste(docWith([]), payload(rects, rects.map((r) => r.id)), "design"));
    expect(plan.select).toHaveLength(50);
  });

  it("does not throw on nodes with missing or odd fields (Review Focus 1)", () => {
    const doc = docWith([]);
    expect(() => planPaste(doc, payload([{ id: "x", type: "shape" }], ["x"]), "design")).not.toThrow();
    expect(reason(planPaste(doc, payload([{ id: "x", type: "shape" }], ["x"]), "design"))).toBe(NOTHING);
    expect(() => planPaste(doc, payload([{ id: "f", type: "frame", content: 5, transform: null }], ["f"]), "design")).not.toThrow();
  });

  it("leaves out photos the design does not use, and says so", () => {
    const text = payload([rect("r", {}), photoFrame("f", "p1")], ["r", "f"]);
    const without = ok(planPaste(docWith([]), text, "design"));
    expect(without.select).toHaveLength(1);
    expect(without.notice).toMatch(/photos/i);
    const withIt = ok(planPaste(withPhoto(), text, "design"));
    expect(withIt.select).toHaveLength(2);
    expect(withIt.notice).toBeUndefined();
  });

  it("says why when only photos were pasted, and drops groups that end up empty", () => {
    const onlyPhoto = payload([photoFrame("f", "p1")], ["f"]);
    expect(reason(planPaste(docWith([]), onlyPhoto, "design"))).toMatch(/already uses/);
    const grouped = payload([group("g", {}, ["f"]), photoFrame("f", "p1")], ["g"]);
    expect(planPaste(docWith([]), grouped, "design").ok).toBe(false);
    const mixed = payload([group("g", {}, ["f", "r"]), photoFrame("f", "p1"), rect("r", {})], ["g"]);
    const plan = ok(planPaste(docWith([]), mixed, "design"));
    expect(Object.keys(applyCommand(docWith([]), plan.command).doc.nodes)).toHaveLength(2);
  });

  it("gives pasted layers free locks in a design", () => {
    const text = payload([{ ...rect("a", {}), lock: "locked" }], ["a"]);
    const plan = ok(planPaste(docWith([]), text, "design"));
    expect(applyCommand(docWith([]), plan.command).doc.nodes[plan.select[0]!]!.lock).toBe("free");
  });

  it("refuses at the layer cap (Review Focus 3)", () => {
    const full = docWith(Array.from({ length: LIMITS.designNodes }, (_, i) => rect(`r${i}`, {})));
    expect(reason(planPaste(full, payload([rect("a", {})], ["a"]), "design"))).toMatch(/up to 500 layers/);
  });
});
