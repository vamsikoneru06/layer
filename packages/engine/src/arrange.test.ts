import { validateDoc, type Doc, type Node } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { lockLabel, planAlign, planDistribute, planFlip, planMoveLayer, planReorder, planToggleLock, type ReorderTarget } from "./arrange";
import { applyCommand } from "./commands";
import { aabb, apply, boxCorners, type Box } from "./math";
import { worldMatrix } from "./scene";
import type { Plan } from "./selection-utils";
import { docWith, group, rect, text } from "./test-docs";

const ok = (plan: Plan) => {
  if (!plan.ok) throw new Error(plan.reason);
  return plan;
};
const run = (doc: Doc, plan: Plan) => applyCommand(doc, ok(plan).command).doc;
const reason = (plan: Plan) => (plan.ok ? "" : plan.reason);
const worldBox = (doc: Doc, id: string): Box => {
  const n = doc.nodes[id]!;
  return aabb(boxCorners(n.width, n.height, worldMatrix(doc, id)));
};
const centre = (doc: Doc, id: string) => apply(worldMatrix(doc, id), { x: 0, y: 0 });
const locked = (n: Node, lock: "locked" | "content-only"): Node => ({ ...n, lock });

describe("planReorder", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i));
  const flat = (n: number) => docWith(ids(n).map((id) => rect(id, {})));

  it("moves one layer forward and backward by one step", () => {
    const doc = flat(4);
    expect(run(doc, planReorder(doc, ["b"], "design", "forward")).root).toEqual(["a", "c", "b", "d"]);
    expect(run(doc, planReorder(doc, ["c"], "design", "backward")).root).toEqual(["a", "c", "b", "d"]);
  });

  it("moves to the front and the back", () => {
    const doc = flat(4);
    expect(run(doc, planReorder(doc, ["b"], "design", "front")).root).toEqual(["a", "c", "d", "b"]);
    expect(run(doc, planReorder(doc, ["c"], "design", "back")).root).toEqual(["c", "a", "b", "d"]);
  });

  it("moves an adjacent selection as a block, keeping its order", () => {
    const doc = flat(5);
    expect(run(doc, planReorder(doc, ["c", "b"], "design", "forward")).root).toEqual(["a", "d", "b", "c", "e"]);
    expect(run(doc, planReorder(doc, ["b", "c"], "design", "backward")).root).toEqual(["b", "c", "a", "d", "e"]);
  });

  it("moves a non-adjacent selection one step each", () => {
    const doc = flat(6);
    // a and d: a passes b, d passes e.
    expect(run(doc, planReorder(doc, ["d", "a"], "design", "forward")).root).toEqual(["b", "a", "c", "e", "d", "f"]);
    expect(run(doc, planReorder(doc, ["b", "e"], "design", "backward")).root).toEqual(["b", "a", "c", "e", "d", "f"]);
  });

  it("lets a selection already at the top move only the others", () => {
    const doc = flat(5);
    // e is on top already and stays; b moves past c.
    expect(run(doc, planReorder(doc, ["b", "e"], "design", "forward")).root).toEqual(["a", "c", "b", "d", "e"]);
  });

  it("sends a non-adjacent selection to the front or back together, in relative order", () => {
    const doc = flat(6);
    expect(run(doc, planReorder(doc, ["e", "b"], "design", "front")).root).toEqual(["a", "c", "d", "f", "b", "e"]);
    expect(run(doc, planReorder(doc, ["e", "b"], "design", "back")).root).toEqual(["b", "e", "a", "c", "d", "f"]);
  });

  it("matches a plain reference for every selection of a short list", () => {
    // Reference for "forward": each run of picked layers swaps with the one unpicked layer above it.
    const forward = (list: string[], picked: Set<string>) => {
      const out: string[] = [];
      for (let i = 0; i < list.length; ) {
        if (!picked.has(list[i]!)) {
          out.push(list[i++]!);
          continue;
        }
        let j = i;
        while (j < list.length && picked.has(list[j]!)) j++;
        if (j < list.length) out.push(list[j]!);
        out.push(...list.slice(i, j));
        i = j + (j < list.length ? 1 : 0);
      }
      return out;
    };
    const n = 6;
    const doc = flat(n);
    for (let mask = 1; mask < 1 << n; mask++) {
      const picked = new Set(ids(n).filter((_, i) => mask & (1 << i)));
      const pickedList = [...picked].reverse(); // selection order must not matter
      const expected: Record<ReorderTarget, string[]> = {
        forward: forward(ids(n), picked),
        backward: forward([...ids(n)].reverse(), picked).reverse(),
        front: [...ids(n).filter((id) => !picked.has(id)), ...ids(n).filter((id) => picked.has(id))],
        back: [...ids(n).filter((id) => picked.has(id)), ...ids(n).filter((id) => !picked.has(id))],
      };
      for (const where of ["forward", "backward", "front", "back"] as const) {
        const plan = planReorder(doc, pickedList, "design", where);
        const after = plan.ok ? applyCommand(doc, plan.command).doc.root : doc.root;
        expect(after, `${where} ${[...picked]}`).toEqual(expected[where]);
        if (!plan.ok) expect(expected[where]).toEqual(ids(n));
        else if (plan.command.type === "batch") for (const c of plan.command.commands) expect(picked.has((c as { id: string }).id)).toBe(true);
      }
    }
  });

  it("moves layers inside each of their own parents", () => {
    const doc = docWith(
      [rect("a", {}), group("g", { x: 500, y: 500 }, ["c1", "c2", "c3"]), rect("z", {})],
      [rect("c1", {}), rect("c2", {}), rect("c3", {})],
    );
    // a is at the bottom of the root, c1 at the bottom of the group: each moves up within its own list.
    const next = run(doc, planReorder(doc, ["a", "c1"], "design", "forward"));
    expect(next.root).toEqual(["g", "a", "z"]);
    expect((next.nodes.g as { children: string[] }).children).toEqual(["c2", "c1", "c3"]);
    const back = run(doc, planReorder(doc, ["z", "c3"], "design", "back"));
    expect(back.root).toEqual(["z", "a", "g"]);
    expect((back.nodes.g as { children: string[] }).children).toEqual(["c3", "c1", "c2"]);
  });

  it("acts on the group, not its selected children, when both are selected", () => {
    const doc = docWith([group("g", {}, ["c"]), rect("z", {})], [rect("c", {})]);
    expect(run(doc, planReorder(doc, ["g", "c"], "design", "front")).root).toEqual(["z", "g"]);
  });

  it("keeps the selection", () => {
    const doc = flat(3);
    expect(ok(planReorder(doc, ["a", "b"], "design", "front")).select).toEqual(["a", "b"]);
  });

  it("refuses with the exact reasons", () => {
    const doc = flat(3);
    expect(reason(planReorder(doc, [], "design", "forward"))).toBe("Select a layer first.");
    expect(reason(planReorder(doc, ["c"], "design", "forward"))).toBe("Already at the front.");
    expect(reason(planReorder(doc, ["b", "c"], "design", "front"))).toBe("Already at the front.");
    expect(reason(planReorder(doc, ["a"], "design", "backward"))).toBe("Already at the back.");
    expect(reason(planReorder(doc, ["a", "b"], "design", "back"))).toBe("Already at the back.");
  });

  it("refuses a locked layer in a design, with the policy's reason, but not in Author Mode", () => {
    const doc = docWith([locked(rect("a", {}), "locked"), rect("b", {})]);
    expect(reason(planReorder(doc, ["a"], "design", "front"))).toBe("This layer is locked. Unlock it to change it.");
    expect(planReorder(doc, ["a"], "template", "front").ok).toBe(true);
  });

  it("does not touch a locked layer that only gets passed", () => {
    const doc = docWith([rect("a", {}), locked(rect("b", {}), "locked")]);
    expect(run(doc, planReorder(doc, ["a"], "design", "forward")).root).toEqual(["b", "a"]);
  });
});

describe("planAlign", () => {
  it("aligns one layer to the artboard", () => {
    const doc = docWith([rect("a", { x: 300, y: 400 }, 100, 60)]);
    const at = (edge: Parameters<typeof planAlign>[3]) => worldBox(run(doc, planAlign(doc, ["a"], "design", edge)), "a");
    expect(at("left").minX).toBeCloseTo(0);
    expect(at("right").maxX).toBeCloseTo(1000);
    expect(at("center")).toMatchObject({ minX: 450, maxX: 550 });
    expect(at("top").minY).toBeCloseTo(0);
    expect(at("bottom").maxY).toBeCloseTo(1000);
    expect(at("middle")).toMatchObject({ minY: 470, maxY: 530 });
  });

  it("changes only the axis it aligns", () => {
    const doc = docWith([rect("a", { x: 300, y: 400, rotation: 20 })]);
    const next = run(doc, planAlign(doc, ["a"], "design", "left"));
    expect(next.nodes.a!.transform).toMatchObject({ y: 400, rotation: 20, scaleX: 1, scaleY: 1 });
  });

  it("uses the visible box of a rotated layer", () => {
    const doc = docWith([rect("a", { x: 300, y: 300, rotation: 45 }, 100, 100)]);
    const half = 50 * Math.SQRT2;
    const left = run(doc, planAlign(doc, ["a"], "design", "left"));
    expect(worldBox(left, "a").minX).toBeCloseTo(0);
    expect(left.nodes.a!.transform.x).toBeCloseTo(half);
    const right = run(doc, planAlign(doc, ["a"], "design", "right"));
    expect(worldBox(right, "a").maxX).toBeCloseTo(1000);
    const bottom = run(doc, planAlign(doc, ["a"], "design", "bottom"));
    expect(worldBox(bottom, "a").maxY).toBeCloseTo(1000);
  });

  it("aligns several layers to the box around all of them", () => {
    const doc = docWith([rect("a", { x: 200, y: 200 }, 100, 100), rect("b", { x: 600, y: 500 }, 200, 50), rect("c", { x: 400, y: 800 }, 40, 40)]);
    // The union box is x 150..700, y 150..820.
    const edge = (e: Parameters<typeof planAlign>[3]) => run(doc, planAlign(doc, ["a", "b", "c"], "design", e));
    for (const id of ["a", "b", "c"]) expect(worldBox(edge("left"), id).minX).toBeCloseTo(150);
    for (const id of ["a", "b", "c"]) expect(worldBox(edge("right"), id).maxX).toBeCloseTo(700);
    for (const id of ["a", "b", "c"]) expect(centre(edge("center"), id).x).toBeCloseTo(425);
    for (const id of ["a", "b", "c"]) expect(worldBox(edge("top"), id).minY).toBeCloseTo(150);
    for (const id of ["a", "b", "c"]) expect(worldBox(edge("bottom"), id).maxY).toBeCloseTo(820);
    for (const id of ["a", "b", "c"]) expect(centre(edge("middle"), id).y).toBeCloseTo(485);
  });

  it("moves a child of a rotated, scaled group by the right amount", () => {
    const doc = docWith([group("g", { x: 500, y: 500, rotation: 90, scaleX: 2, scaleY: 2 }, ["c"])], [rect("c", { x: 30, y: 10, rotation: 15 }, 50, 50)]);
    const before = worldBox(doc, "c");
    const left = run(doc, planAlign(doc, ["c"], "design", "left"));
    expect(worldBox(left, "c").minX).toBeCloseTo(0);
    expect(worldBox(left, "c").minY).toBeCloseTo(before.minY);
    const top = run(doc, planAlign(doc, ["c"], "design", "top"));
    expect(worldBox(top, "c").minY).toBeCloseTo(0);
    expect(worldBox(top, "c").minX).toBeCloseTo(before.minX);
    const middle = run(doc, planAlign(doc, ["c"], "design", "middle"));
    expect(centre(middle, "c").y).toBeCloseTo(500);
    expect(validateDoc(left)).toMatchObject({ ok: true });
  });

  it("aligns a group to the page using the group's own box", () => {
    const doc = docWith([group("g", { x: 500, y: 500 }, ["c"], 200, 100)], [rect("c", {}, 50, 50)]);
    const next = run(doc, planAlign(doc, ["g"], "design", "right"));
    expect(next.nodes.g!.transform.x).toBeCloseTo(900);
  });

  it("leaves layers that are already in place and refuses when nothing would move", () => {
    const doc = docWith([rect("a", { x: 50, y: 300 }), rect("b", { x: 400, y: 300 })]);
    const plan = ok(planAlign(doc, ["a", "b"], "design", "left"));
    expect(plan.command).toMatchObject({ type: "batch", commands: [{ type: "update", id: "b" }] });
    expect(reason(planAlign(doc, ["a"], "design", "left"))).toBe("Already aligned.");
    expect(reason(planAlign(doc, ["a", "b"], "design", "middle"))).toBe("Already aligned.");
  });

  it("ignores sub-thousandth shifts", () => {
    const doc = docWith([rect("a", { x: 50.0001, y: 300 })]);
    expect(reason(planAlign(doc, ["a"], "design", "left"))).toBe("Already aligned.");
  });

  it("refuses with no selection and keeps the selection otherwise", () => {
    const doc = docWith([rect("a", { x: 300 })]);
    expect(reason(planAlign(doc, [], "design", "left"))).toBe("Select a layer first.");
    expect(ok(planAlign(doc, ["a"], "design", "left")).select).toEqual(["a"]);
  });

  it("follows the lock policy", () => {
    const layout = docWith([locked(rect("a", { x: 300 }), "content-only")]);
    expect(reason(planAlign(layout, ["a"], "design", "left"))).toBe("Layout locked by the template. You can still change the text or photo.");
    const fully = docWith([locked(rect("a", { x: 300 }), "locked")]);
    expect(reason(planAlign(fully, ["a"], "design", "left"))).toBe("This layer is locked. Unlock it to change it.");
    expect(planAlign(fully, ["a"], "template", "left").ok).toBe(true);
  });
});

describe("planDistribute", () => {
  const gaps = (doc: Doc, ids: string[], axis: "x" | "y") => {
    const boxes = ids.map((id) => worldBox(doc, id)).sort((a, b) => (axis === "x" ? a.minX - b.minX : a.minY - b.minY));
    return boxes.slice(1).map((b, i) => (axis === "x" ? b.minX - boxes[i]!.maxX : b.minY - boxes[i]!.maxY));
  };

  it("spaces three layers evenly and keeps the outer two", () => {
    const doc = docWith([rect("a", { x: 100, y: 100 }), rect("b", { x: 200, y: 300 }), rect("c", { x: 800, y: 500 })]);
    const next = run(doc, planDistribute(doc, ["a", "b", "c"], "design", "horizontal"));
    expect(next.nodes.a!.transform).toEqual(doc.nodes.a!.transform);
    expect(next.nodes.c!.transform).toEqual(doc.nodes.c!.transform);
    expect(centre(next, "b")).toMatchObject({ x: 450, y: 300 });
    const [g1, g2] = gaps(next, ["a", "b", "c"], "x");
    expect(g1).toBeCloseTo(g2!);
  });

  it("spaces four layers of different sizes, whatever order they were selected in", () => {
    const doc = docWith([rect("a", { x: 100 }, 100, 40), rect("b", { x: 250 }, 60, 40), rect("c", { x: 330 }, 200, 40), rect("d", { x: 900 }, 50, 40)]);
    const next = run(doc, planDistribute(doc, ["d", "b", "a", "c"], "design", "horizontal"));
    const [g1, g2, g3] = gaps(next, ["a", "b", "c", "d"], "x");
    expect(g1).toBeCloseTo(g2!);
    expect(g2).toBeCloseTo(g3!);
    expect(worldBox(next, "a").minX).toBeCloseTo(50);
    expect(worldBox(next, "d").maxX).toBeCloseTo(925);
    // The stacking order is untouched.
    expect(next.root).toEqual(doc.root);
  });

  it("distributes vertically", () => {
    const doc = docWith([rect("a", { y: 100 }), rect("b", { y: 150 }), rect("c", { y: 160 }), rect("d", { y: 900 })]);
    const next = run(doc, planDistribute(doc, ["a", "b", "c", "d"], "design", "vertical"));
    const [g1, g2, g3] = gaps(next, ["a", "b", "c", "d"], "y");
    expect(g1).toBeCloseTo(g2!);
    expect(g2).toBeCloseTo(g3!);
    expect(next.nodes.b!.transform.x).toBe(0);
  });

  it("allows negative gaps when the boxes overlap", () => {
    const doc = docWith([rect("a", { x: 100 }), rect("b", { x: 110 }), rect("c", { x: 160 })]);
    const next = run(doc, planDistribute(doc, ["a", "b", "c"], "design", "horizontal"));
    expect(next.nodes.b!.transform.x).toBeCloseTo(130);
    expect(gaps(next, ["a", "b", "c"], "x")).toEqual([expect.closeTo(-70), expect.closeTo(-70)]);
    const tight = docWith([rect("a", { x: 100 }), rect("b", { x: 100 }), rect("c", { x: 200 })]);
    const spread = run(tight, planDistribute(tight, ["a", "b", "c"], "design", "horizontal"));
    expect(spread.nodes.b!.transform.x).toBeCloseTo(150);
  });

  it("moves layers inside a scaled group in the group's space", () => {
    const doc = docWith(
      [group("g", { x: 500, y: 500, rotation: 90, scaleX: 2, scaleY: 2 }, ["a", "b", "c"])],
      [rect("a", { x: -100, y: -60 }, 20, 20), rect("b", { x: -80, y: 30 }, 20, 20), rect("c", { x: 100, y: 60 }, 20, 20)],
    );
    const next = run(doc, planDistribute(doc, ["a", "b", "c"], "design", "horizontal"));
    const [g1, g2] = gaps(next, ["a", "b", "c"], "x");
    expect(g1).toBeCloseTo(g2!);
    expect(worldBox(next, "a")).toEqual(worldBox(doc, "a"));
  });

  it("refuses for fewer than three layers and when already even", () => {
    const doc = docWith([rect("a", { x: 100 }), rect("b", { x: 300 }), rect("c", { x: 500 })]);
    expect(reason(planDistribute(doc, [], "design", "horizontal"))).toBe("Select three or more layers to distribute.");
    expect(reason(planDistribute(doc, ["a", "b"], "design", "vertical"))).toBe("Select three or more layers to distribute.");
    expect(reason(planDistribute(doc, ["a", "b", "c"], "design", "horizontal"))).toBe("Already evenly spaced.");
  });

  it("keeps the selection and follows the lock policy", () => {
    const doc = docWith([rect("a", { x: 100 }), locked(rect("b", { x: 200 }), "locked"), rect("c", { x: 800 })]);
    expect(reason(planDistribute(doc, ["a", "b", "c"], "design", "horizontal"))).toBe("This layer is locked. Unlock it to change it.");
    const free = docWith([rect("a", { x: 100 }), rect("b", { x: 200 }), rect("c", { x: 800 })]);
    expect(ok(planDistribute(free, ["c", "a", "b"], "design", "horizontal")).select).toEqual(["c", "a", "b"]);
  });
});

describe("planFlip", () => {
  it("mirrors in the parent frame: one scale and the rotation are negated, the centre stays put", () => {
    const doc = docWith([rect("a", { x: 300, y: 200, rotation: 30, scaleX: 1.5, scaleY: 2 })]);
    const h = run(doc, planFlip(doc, ["a"], "design", "horizontal"));
    expect(h.nodes.a!.transform).toEqual({ x: 300, y: 200, rotation: -30, scaleX: -1.5, scaleY: 2 });
    const v = run(doc, planFlip(doc, ["a"], "design", "vertical"));
    expect(v.nodes.a!.transform).toEqual({ x: 300, y: 200, rotation: -30, scaleX: 1.5, scaleY: -2 });
    expect(centre(h, "a")).toEqual(centre(doc, "a"));
    expect(validateDoc(h)).toMatchObject({ ok: true });
  });

  describe("on screen", () => {
    const corners = (doc: Doc, id: string) => {
      const n = doc.nodes[id]!;
      return boxCorners(n.width, n.height, worldMatrix(doc, id));
    };
    const area = (ps: { x: number; y: number }[]) => ps.reduce((sum, p, i) => sum + (p.x * ps[(i + 1) % ps.length]!.y - ps[(i + 1) % ps.length]!.x * p.y), 0) / 2;
    /** After the flip `id` covers the mirror image of where it was, about `about`'s centre, with its orientation reversed. */
    const expectMirrored = (before: Doc, after: Doc, id: string, axis: "horizontal" | "vertical", about = id) => {
      const c = centre(before, about);
      const mirror = (p: { x: number; y: number }) => (axis === "horizontal" ? { x: 2 * c.x - p.x, y: p.y } : { x: p.x, y: 2 * c.y - p.y });
      const got = corners(after, id);
      // Compare as point sets: a rectangle's mirror image is the same corner set listed in another order.
      for (const w of corners(before, id).map(mirror)) expect(got.some((g) => Math.hypot(g.x - w.x, g.y - w.y) < 1e-6)).toBe(true);
      expect(Math.sign(area(got))).toBe(-Math.sign(area(corners(before, id))));
    };
    const wide = (id: string, t: Parameters<typeof rect>[1]) => ({ ...rect(id, t), width: 300, height: 100 });

    it.each([0, 30, 90, -135])("mirrors a layer rotated %i degrees across its own vertical and horizontal line", (rotation) => {
      const doc = docWith([wide("a", { x: 400, y: 300, rotation })]);
      for (const axis of ["horizontal", "vertical"] as const) {
        const next = run(doc, planFlip(doc, ["a"], "design", axis));
        expectMirrored(doc, next, "a", axis);
        expect(run(next, planFlip(next, ["a"], "design", axis))).toEqual(doc);
      }
    });

    it("mirrors a layer inside a rotated group on screen, not across the group's axis", () => {
      const doc = docWith([group("g", { x: 500, y: 500, rotation: 25 }, ["c"])], [wide("c", { x: 60, y: -40, rotation: 10 })]);
      for (const axis of ["horizontal", "vertical"] as const) {
        const next = run(doc, planFlip(doc, ["c"], "design", axis));
        expectMirrored(doc, next, "c", axis);
        expect(run(next, planFlip(next, ["c"], "design", axis)).nodes.c!.transform.rotation).toBeCloseTo(10, 9);
      }
    });

    it("mirrors a layer inside a rotated, already flipped group on screen", () => {
      const doc = docWith([group("g", { x: 500, y: 500, rotation: 40, scaleX: -1 }, ["c"])], [wide("c", { x: 60, y: -40, rotation: 70 })]);
      for (const axis of ["horizontal", "vertical"] as const) expectMirrored(doc, run(doc, planFlip(doc, ["c"], "design", axis)), "c", axis);
    });

    it("mirrors a rotated group as a whole", () => {
      const doc = docWith([group("g", { x: 500, y: 500, rotation: 90 }, ["c"])], [wide("c", { x: 60, y: -40 })]);
      for (const axis of ["horizontal", "vertical"] as const) {
        const next = run(doc, planFlip(doc, ["g"], "design", axis));
        expectMirrored(doc, next, "c", axis, "g");
      }
    });

    it("keeps the rotation inside the schema limit", () => {
      const doc = docWith([group("g", { rotation: 90 }, ["c"])], [rect("c", { rotation: 3_599 })]);
      const next = run(doc, planFlip(doc, ["c"], "design", "horizontal"));
      expect(validateDoc(next)).toMatchObject({ ok: true });
    });
  });

  it("flips several layers each about its own centre, and flipping twice restores the design", () => {
    const doc = docWith([rect("a", { x: 100, rotation: 10 }), rect("b", { x: 400, scaleX: -1 })]);
    const once = run(doc, planFlip(doc, ["a", "b"], "design", "horizontal"));
    expect(once.nodes.b!.transform.scaleX).toBe(1);
    expect(run(once, planFlip(once, ["a", "b"], "design", "horizontal"))).toEqual(doc);
    const vert = run(doc, planFlip(doc, ["a", "b"], "design", "vertical"));
    expect(run(vert, planFlip(vert, ["a", "b"], "design", "vertical"))).toEqual(doc);
  });

  it("flips a group as a whole without touching its children", () => {
    const doc = docWith([group("g", { x: 500, y: 500 }, ["c"])], [rect("c", { x: 30 })]);
    const next = run(doc, planFlip(doc, ["g"], "design", "horizontal"));
    expect(next.nodes.g!.transform.scaleX).toBe(-1);
    expect(next.nodes.c).toBe(doc.nodes.c);
    expect(centre(next, "c").x).toBeCloseTo(470);
  });

  it("refuses text, and any group with text somewhere inside", () => {
    const doc = docWith(
      [text("t", {}), group("g", {}, ["inner"]), rect("r", {})],
      [group("inner", {}, ["deep"]), text("deep", {})],
    );
    expect(reason(planFlip(doc, ["t"], "design", "horizontal"))).toBe("Text can't be flipped.");
    expect(reason(planFlip(doc, ["g"], "design", "vertical"))).toBe("Text can't be flipped.");
    expect(reason(planFlip(doc, ["r", "t"], "design", "horizontal"))).toBe("Text can't be flipped.");
    expect(planFlip(doc, ["r"], "design", "horizontal").ok).toBe(true);
  });

  it("refuses with no selection, keeps the selection, and follows the lock policy", () => {
    const doc = docWith([rect("a", {}), locked(rect("b", {}), "content-only")]);
    expect(reason(planFlip(doc, [], "design", "horizontal"))).toBe("Select a layer first.");
    expect(ok(planFlip(doc, ["a"], "design", "horizontal")).select).toEqual(["a"]);
    expect(reason(planFlip(doc, ["b"], "design", "horizontal"))).toBe("Layout locked by the template. You can still change the text or photo.");
  });
});

describe("planToggleLock and lockLabel", () => {
  it("locks free layers, then unlocks them", () => {
    const doc = docWith([rect("a", {}), rect("b", {})]);
    expect(lockLabel(doc, ["a", "b"])).toBe("Lock");
    const locking = run(doc, planToggleLock(doc, ["a", "b"], "design"));
    expect([locking.nodes.a!.lock, locking.nodes.b!.lock]).toEqual(["locked", "locked"]);
    expect(lockLabel(locking, ["a", "b"])).toBe("Unlock");
    const back = run(locking, planToggleLock(locking, ["a", "b"], "design"));
    expect(back).toEqual(doc);
  });

  it("unlocks a mixed selection rather than locking the rest", () => {
    const doc = docWith([rect("a", {}), locked(rect("b", {}), "locked"), locked(rect("c", {}), "content-only")]);
    expect(lockLabel(doc, ["a", "b", "c"])).toBe("Unlock");
    const plan = ok(planToggleLock(doc, ["a", "b", "c"], "design"));
    expect(plan.command).toMatchObject({ type: "batch", commands: [{ id: "b" }, { id: "c" }] });
    const next = applyCommand(doc, plan.command).doc;
    expect(["a", "b", "c"].map((id) => next.nodes[id]!.lock)).toEqual(["free", "free", "free"]);
  });

  it("lets a user unlock a template-locked layer (the policy allows lock-only changes) and then edit it", () => {
    const doc = docWith([locked(rect("a", { x: 300 }), "locked")]);
    expect(reason(planAlign(doc, ["a"], "design", "left"))).toBe("This layer is locked. Unlock it to change it.");
    const unlocked = run(doc, planToggleLock(doc, ["a"], "design"));
    expect(unlocked.nodes.a!.lock).toBe("free");
    expect(planAlign(unlocked, ["a"], "design", "left").ok).toBe(true);
  });

  it("works in Author Mode", () => {
    const doc = docWith([rect("a", {})]);
    expect(run(doc, planToggleLock(doc, ["a"], "template")).nodes.a!.lock).toBe("locked");
  });

  it("locks a group itself, and acts on the group when its child is also selected", () => {
    const doc = docWith([group("g", {}, ["c"])], [rect("c", {})]);
    const next = run(doc, planToggleLock(doc, ["g", "c"], "design"));
    expect(next.nodes.g!.lock).toBe("locked");
    expect(next.nodes.c!.lock).toBe("free");
  });

  it("refuses with no selection, says Lock for none, and keeps the selection", () => {
    const doc = docWith([rect("a", {})]);
    expect(reason(planToggleLock(doc, [], "design"))).toBe("Select a layer first.");
    expect(lockLabel(doc, [])).toBe("Lock");
    expect(ok(planToggleLock(doc, ["a"], "design")).select).toEqual(["a"]);
  });
});

describe("planMoveLayer", () => {
  const flat = () => docWith(["a", "b", "c", "d"].map((id) => rect(id, {})));

  it("moves a layer up, down and to either end among its siblings", () => {
    const doc = flat();
    expect(run(doc, planMoveLayer(doc, "a", 2, "design")).root).toEqual(["b", "c", "a", "d"]);
    expect(run(doc, planMoveLayer(doc, "d", 1, "design")).root).toEqual(["a", "d", "b", "c"]);
    expect(run(doc, planMoveLayer(doc, "b", 3, "design")).root).toEqual(["a", "c", "d", "b"]);
    expect(run(doc, planMoveLayer(doc, "c", 0, "design")).root).toEqual(["c", "a", "b", "d"]);
  });

  it("clamps an index past either end", () => {
    const doc = flat();
    expect(run(doc, planMoveLayer(doc, "a", 99, "design")).root).toEqual(["b", "c", "d", "a"]);
    expect(run(doc, planMoveLayer(doc, "d", -5, "design")).root).toEqual(["d", "a", "b", "c"]);
  });

  it("refuses a move that changes nothing", () => {
    const doc = flat();
    expect(reason(planMoveLayer(doc, "b", 1, "design"))).toBe("Already there.");
    expect(reason(planMoveLayer(doc, "d", 99, "design"))).toBe("Already there.");
  });

  it("refuses an unknown layer", () => {
    expect(reason(planMoveLayer(flat(), "zzz", 0, "design"))).toBe("Select a layer first.");
  });

  it("moves inside its own group only", () => {
    const doc = docWith([group("g", {}, ["x", "y", "z"]), rect("a", {})], [rect("x", {}), rect("y", {}), rect("z", {})]);
    const next = run(doc, planMoveLayer(doc, "x", 2, "design"));
    expect((next.nodes.g as { children: string[] }).children).toEqual(["y", "z", "x"]);
    expect(next.root).toEqual(["g", "a"]);
    expect(reason(planMoveLayer(doc, "x", 0, "design"))).toBe("Already there.");
  });

  it("is the one reorder command with the layer selected afterwards", () => {
    const doc = flat();
    const plan = ok(planMoveLayer(doc, "a", 2, "design"));
    expect(plan.command).toEqual({ type: "reorder", id: "a", index: 2 });
    expect(plan.select).toEqual(["a"]);
  });

  it("refuses a locked layer with the policy's reason, but not in Author Mode, and moves past a locked sibling", () => {
    const doc = docWith([locked(rect("a", {}), "locked"), rect("b", {}), locked(rect("c", {}), "content-only")]);
    expect(reason(planMoveLayer(doc, "a", 2, "design"))).toBe("This layer is locked. Unlock it to change it.");
    expect(reason(planMoveLayer(doc, "c", 0, "design"))).toBe("Layout locked by the template. You can still change the text or photo.");
    expect(planMoveLayer(doc, "a", 2, "template").ok).toBe(true);
    expect(run(doc, planMoveLayer(doc, "b", 0, "design")).root).toEqual(["b", "a", "c"]);
  });
});