# Editor Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the editor a complete, honest frame: File/Edit/View/Help menus, inline rename, Ctrl+S, toasts, a bottom zoom bar, a right-click menu, keyboard shortcuts, and the edit commands they need (cut, copy, paste, duplicate, group, ungroup).

**Architecture:** Every editor action is defined once in an action registry (`editor-actions.ts`). The menus, the right-click menu, the shortcuts dialog and the bottom bar are generated from it, so a control cannot exist in one place and be dead in another. The edit commands live in the engine as pure "plan" builders that emit the existing `insert`/`delete` commands, so undo and the lock policy come for free; the only new `Command` is `meta` (rename).

**Tech Stack:** TypeScript, Next.js 16 / React 19, Tailwind v4, `lucide-react`, Vitest (node environment), pnpm workspace (`@vash/engine`, `@vash/schema`, `@vash/web`).

**Spec:** `docs/superpowers/specs/2026-09-29-editor-shell-design.md` (sections 3.1 to 3.7). Read `AGENTS.md` first.

## Decisions that refine the spec

The spec left these to the plan. They are settled here and Task 16 writes them back into the spec.

1. **No `group`/`ungroup` Command types.** Group, ungroup, duplicate and paste are functions that return a `batch` of the existing `insert` and `delete` commands. `applyCommand`, `History` and `checkPolicy` need no change, undo is one step, and locked layers are refused by the same policy code.
2. **One new Command, `meta`** (`{ type: "meta"; patch: { title?: string } }`). Rename must change the open document. `PATCH /api/designs/:id` alone would be undone by the next autosave, because `PUT` sets the stored title from `doc.meta.title` (`server/designs/repository.ts:64`). So rename is `dispatch({ type: "meta", ... })` and the normal autosave persists it. `renameDesign` is not used. A rename can be undone with Ctrl+Z; that is accepted.
3. **Every plan is validated before it is applied.** `runPlan` applies the command to a copy, runs `validateDoc`, and refuses with a notice if the result is invalid. A hostile clipboard, a huge scale or a shear can never put a bad document in history.
4. **Copies get `lock: "free"` in a design** (the user's own new layers). In a template (Author Mode) locks are kept.
5. **Ungroup refuses** (with a message) when the group is stretched so that a rotated child would need shear. It never produces a wrong picture.
6. **Photos and stickers whose asset the design does not already use are dropped on paste**, with a notice (spec 3.2). Copy and paste of photos between different designs is therefore not supported yet; it arrives with the Photos panel.
7. **Preview** (list item "Preview") is the View menu's Hide panels.

## Global Constraints

- **Everything must be free.** No new service, no new dependency. (`AGENTS.md` Hard rules, Money.)
- **No em dashes** in anything a user reads. Use a period, comma or colon. (`AGENTS.md` design rule 12.)
- **No emoji icons.** Icons come from `lucide-react`. (rule 7)
- **No pill-shaped buttons.** Use `rounded-lg` or `rounded-xl`; the shared button radius is 12px. (rule 6)
- **No fake copy.** Text must be true; menus show only actions that work. (`AGENTS.md`, Copy must be true; spec 3.7)
- **Strict CSP:** no third-party script, font or image host. This plan adds none. (`AGENTS.md` Security)
- **Documents are immutable.** Every edit is a `Command` through `EditorCore.dispatch`; the lock policy is enforced in the engine, not just hidden in the UI. (`AGENTS.md` Engine conventions)
- **A node's `transform.x/y` is its centre; local matrix = translate · rotate · scale. Group children are relative to the group centre.** (`AGENTS.md`)
- **Documents never contain URLs;** assets are referenced by id. The clipboard payload carries node data and asset ids only, never URLs. (`AGENTS.md`, spec 3.2)
- **The editor draws on `requestAnimationFrame`,** so a hidden tab draws nothing. Verify canvas state with `editor.exportPng()` or DOM state, not screenshots. (`AGENTS.md`)
- **Match the surrounding code:** comment density, naming, small focused files. Change only what the task needs.
- **Web unit tests run in the `node` environment** (`apps/web/vitest.config.ts`); there is no jsdom or Testing Library. Put logic in pure `.ts` files and test that; components are checked in a browser (Task 16).
- **Workflow:** branch `feat/editor-shell` (already created). Before the PR, `corepack pnpm -r test`, `corepack pnpm typecheck` and `corepack pnpm lint` must pass. Check UI in a real browser, in light and dark mode, and at 1024 px wide.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Inputs and conditions the spec implies but does not spell out, most likely to bite first. Each has a pinned test in the task named.

1. **Hostile or malformed clipboard text** (not `vash:`, bad JSON, wrong version, extra keys on a node, `__proto__`, missing `transform`, huge numbers, a group that contains itself, duplicate ids): paste must do nothing, leave the document unchanged and say "Nothing to paste." or a clear message; never throw and never pollute prototypes. Tests: Task 5, Task 6.
2. **Grouping or ungrouping rotated, scaled or flipped layers:** the layers must not move on screen (world matrix unchanged), and a case that cannot be represented must be refused, not corrupted. Tests: Task 2, Task 4.
3. **Duplicate or paste at the layer cap (500 in a design, 150 in a template):** refuse with "A design can have up to N layers." instead of producing an invalid document. Tests: Task 3, Task 5, Task 6.
4. **Locked layers:** cut, delete, group and ungroup must be refused with the template's reason, and a refused cut must not put anything on the clipboard. Tests: Task 4, Task 6.
5. **Rename input:** whitespace only, control characters or newlines, and 121 characters must be rejected or cleaned; a rename must survive the next autosave and be undoable. Tests: Task 1, Task 7.

Also covered by a manual browser check (Task 16), because the code path is DOM-only: design shortcuts must not fire while typing in an input or while a dialog is open.

---

## File structure

**Engine (`packages/engine/src`)**

| File | Change | Responsibility |
|---|---|---|
| `commands.ts` | modify | Add the `meta` command |
| `policy.ts` | modify | `meta` is always allowed |
| `math.ts` | modify | `decompose`, `matricesClose` |
| `selection-utils.ts` | create | `Plan` type, `topLevelSelection`, `siblingsOf`, `subtreeOf`, layer cap helpers |
| `clipboard.ts` | create | `cloneSubtree`, `planDuplicate`, `serializeSelection`, `planPaste` |
| `structure.ts` | create | `planGroup`, `planUngroup` |
| `edit-ops.ts` | create | `runPlan` (validate, dispatch, select) and the `*Selection` / `pasteText` wrappers |
| `shortcuts.ts` | modify | Ctrl+D, Ctrl+G, Ctrl+Shift+G |
| `editor.ts` | modify | Design shortcuts ignore keys pressed inside a dialog |
| `index.ts` | modify | Export the new API |

**Web (`apps/web/src`)**

| File | Change | Responsibility |
|---|---|---|
| `lib/title.ts` | create | `normalizeTitle` |
| `lib/zoom-slider.ts` | create | Log-scale slider mapping |
| `lib/menu-position.ts` | create | Keep a context menu on screen |
| `lib/design-info.ts` | create | Rows for the Design info dialog |
| `components/ui/menu.tsx` | modify | Shortcuts and disabled items; export the item list for reuse |
| `components/editor/editor-actions.ts` | create | Action registry, menu layouts, shortcut labels |
| `components/editor/use-clipboard.ts` | create | Copy, cut, paste from events and menus |
| `components/editor/use-fullscreen.ts` | create | Fullscreen state and toggle |
| `components/editor/icon-button.tsx` | create | Moved out of `workspace.tsx` |
| `components/editor/save-indicator.tsx` | create | Moved out of `workspace.tsx` |
| `components/editor/title-field.tsx` | create | Inline rename |
| `components/editor/editor-header.tsx` | create | Logo, menus, title, save status, undo/redo, Export |
| `components/editor/menu-bar.tsx` | create | File, Edit, View, Help |
| `components/editor/bottom-bar.tsx` | create | Zoom controls, slider, fullscreen, help |
| `components/editor/context-menu.tsx` | create | Right-click menu |
| `components/editor/shortcuts-dialog.tsx` | create | Shortcut list from the registry |
| `components/editor/design-info-dialog.tsx` | create | Real design facts |
| `components/editor/move-dialog.tsx` | create | Move to folder |
| `components/editor/export-popover.tsx` | modify | Open state controlled by the parent |
| `components/editor/editor-screen.tsx` | modify | Wrap the editor in `ToastProvider` |
| `components/editor/workspace.tsx` | modify | Compose the above; drop the old header, footer and notice line |

Test files sit next to their source (`*.test.ts`).

Run a single test file with:
- engine: `corepack pnpm --filter @vash/engine exec vitest run src/<file>.test.ts`
- web: `corepack pnpm --filter @vash/web exec vitest run src/<path>.test.ts`

---

### Task 1: `meta` command (rename support)

**Files:**
- Modify: `packages/engine/src/commands.ts` (type at line 16-17, `applyCommand` switch near line 103)
- Modify: `packages/engine/src/policy.ts:19-20`
- Test: `packages/engine/src/meta-command.test.ts` (create)

**Interfaces:**
- Produces: `Command` gains `{ type: "meta"; patch: Partial<Pick<Doc["meta"], "title">> }`. `applyCommand` returns an inverse `meta` command, or a no-op (same doc object) when the title is unchanged.

Only `commands.ts` and `policy.ts` switch over `Command["type"]` (checked with `grep -rn 'case "reorder"'`), so no other file needs a new case.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/meta-command.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyCommand } from "./commands";
import { EditorCore } from "./editor-core";
import { docWith, rect } from "./test-docs";

describe("meta command", () => {
  it("changes the title and its inverse restores it", () => {
    const doc = docWith([rect("a", {})]);
    const { doc: next, inverse } = applyCommand(doc, { type: "meta", patch: { title: "Summer sale" } });
    expect(next.meta.title).toBe("Summer sale");
    expect(applyCommand(next, inverse).doc.meta.title).toBe("Test");
  });

  it("does nothing when the title is unchanged, so it adds no undo step", () => {
    const core = new EditorCore(docWith([]));
    core.dispatch({ type: "meta", patch: { title: "Test" } });
    expect(core.getState().canUndo).toBe(false);
  });

  it("is one undo step and is allowed even when layers are locked", () => {
    const core = new EditorCore(docWith([{ ...rect("a", {}), lock: "locked" }]));
    expect(core.dispatch({ type: "meta", patch: { title: "New name" } })).toBe(true);
    expect(core.doc.meta.title).toBe("New name");
    core.undo();
    expect(core.doc.meta.title).toBe("Test");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --filter @vash/engine exec vitest run src/meta-command.test.ts`
Expected: FAIL (type error or `title` stays "Test", because `meta` is not a known command).

- [ ] **Step 3: Add the command**

In `packages/engine/src/commands.ts`, add to the `Command` union, after the `artboard` line:

```ts
  /** Changes the design's title. */
  | { type: "meta"; patch: Partial<Pick<Doc["meta"], "title">> }
```

and add this case to the `switch` in `applyCommand`, before `case "batch"`:

```ts
    case "meta": {
      const { title } = cmd.patch;
      if (title === undefined || title === doc.meta.title) return { doc, inverse: NOOP };
      return { doc: { ...doc, meta: { ...doc.meta, title } }, inverse: { type: "meta", patch: { title: doc.meta.title } } };
    }
```

In `packages/engine/src/policy.ts`, change:

```ts
    case "insert":
      return OK;
```

to:

```ts
    case "insert":
    case "meta":
      return OK;
```

- [ ] **Step 4: Run the test and the engine suite**

Run: `corepack pnpm --filter @vash/engine exec vitest run src/meta-command.test.ts`
Expected: PASS (3 tests).

Run: `corepack pnpm --filter @vash/engine test` and `corepack pnpm --filter @vash/engine typecheck`
Expected: all pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/commands.ts packages/engine/src/policy.ts packages/engine/src/meta-command.test.ts
git commit -m "feat(engine): meta command to change the design title" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Matrix decomposition

**Files:**
- Modify: `packages/engine/src/math.ts` (append after `fromTransform`, line 65)
- Test: `packages/engine/src/decompose.test.ts` (create)

**Interfaces:**
- Produces: `decompose(m: Mat): Transform` (inverse of `fromTransform` for T·R·S matrices) and `matricesClose(a: Mat, b: Mat, epsilon?: number): boolean`. Task 4 uses both to bake a group's transform into its children and to detect shear.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/decompose.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decompose, fromTransform, matricesClose, multiply } from "./math";

describe("decompose", () => {
  it("inverts fromTransform, including flips and negative rotation", () => {
    const cases = [
      { x: 10, y: 20, rotation: 30, scaleX: 2, scaleY: 3 },
      { x: -5, y: 7, rotation: -120, scaleX: 1, scaleY: -1 },
      { x: 0, y: 0, rotation: 0, scaleX: -1, scaleY: 1 },
    ];
    for (const t of cases) {
      const m = fromTransform(t);
      expect(matricesClose(fromTransform(decompose(m)), m)).toBe(true);
    }
  });

  it("keeps position, rotation and uniform scale readable", () => {
    const t = decompose(fromTransform({ x: 5, y: 6, rotation: 90, scaleX: 2, scaleY: 2 }));
    expect(t.x).toBeCloseTo(5);
    expect(t.y).toBeCloseTo(6);
    expect(t.rotation).toBeCloseTo(90);
    expect(t.scaleX).toBeCloseTo(2);
    expect(t.scaleY).toBeCloseTo(2);
  });

  it("reports shear as not representable (a rotated layer in a stretched group)", () => {
    const stretch = fromTransform({ x: 0, y: 0, rotation: 0, scaleX: 2, scaleY: 1 });
    const turned = fromTransform({ x: 0, y: 0, rotation: 45, scaleX: 1, scaleY: 1 });
    const m = multiply(stretch, turned);
    expect(matricesClose(fromTransform(decompose(m)), m)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --filter @vash/engine exec vitest run src/decompose.test.ts`
Expected: FAIL (`decompose` is not exported).

- [ ] **Step 3: Implement**

Append to `packages/engine/src/math.ts`:

```ts
/**
 * Splits a matrix of the form T·R·S back into a Transform. A matrix with shear has no such form, so
 * check `matricesClose(fromTransform(decompose(m)), m)` before trusting the result.
 */
export function decompose(m: Mat): Transform {
  const sx = Math.hypot(m[0], m[1]);
  if (sx === 0) return { x: m[4], y: m[5], rotation: 0, scaleX: 0, scaleY: 0 };
  return { x: m[4], y: m[5], rotation: (Math.atan2(m[1], m[0]) * 180) / Math.PI, scaleX: sx, scaleY: (m[0] * m[3] - m[1] * m[2]) / sx };
}

/** Are two matrices equal up to rounding? */
export function matricesClose(a: Mat, b: Mat, epsilon = 1e-6): boolean {
  return a.every((v, i) => Math.abs(v - b[i]!) <= epsilon * (1 + Math.abs(v)));
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @vash/engine exec vitest run src/decompose.test.ts src/math.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/math.ts packages/engine/src/decompose.test.ts
git commit -m "feat(engine): decompose a matrix into a transform" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Selection helpers and duplicate

**Files:**
- Create: `packages/engine/src/selection-utils.ts`
- Create: `packages/engine/src/clipboard.ts` (clone and duplicate now; copy and paste in Task 5)
- Test: `packages/engine/src/duplicate.test.ts` (create)

**Interfaces:**
- Produces (`selection-utils.ts`):
  - `type Plan = { ok: true; command: Command; select: NodeId[]; notice?: string } | { ok: false; reason: string }`
  - `refuse(reason: string): Plan`
  - `siblingsOf(doc: Doc, parent: NodeId | null): readonly NodeId[]`
  - `subtreeOf(get: (id: NodeId) => Node | undefined, id: NodeId): Node[]` (the node, then its descendants)
  - `topLevelSelection(doc: Doc, ids: readonly NodeId[]): NodeId[]` (drops ids inside another selected layer; stacking order, bottom first)
  - `nodeCap(doc: Doc): number`, `layerLimit(doc: Doc): string`
- Produces (`clipboard.ts`): `DUPLICATE_OFFSET = 20`, `cloneSubtree(get, id, { dx, dy, freeLocks }): Node[]`, `planDuplicate(doc: Doc, ids: readonly NodeId[], mode: EditMode): Plan`.

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/duplicate.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --filter @vash/engine exec vitest run src/duplicate.test.ts`
Expected: FAIL (modules do not exist).

- [ ] **Step 3: Create `selection-utils.ts`**

```ts
import { LIMITS, type Doc, type Node, type NodeId } from "@vash/schema";
import type { Command } from "./commands";
import { parentOf } from "./scene";

/** What an edit will do, worked out before anything changes: the command and what to select after, or why not. */
export type Plan = { ok: true; command: Command; select: NodeId[]; notice?: string } | { ok: false; reason: string };

export const refuse = (reason: string): Plan => ({ ok: false, reason });

/** Child list of `parent` (null = the document root). */
export function siblingsOf(doc: Doc, parent: NodeId | null): readonly NodeId[] {
  if (parent === null) return doc.root;
  const node = doc.nodes[parent];
  return node?.type === "group" ? node.children : [];
}

/** `id` followed by all its descendants, parents before children. */
export function subtreeOf(get: (id: NodeId) => Node | undefined, id: NodeId): Node[] {
  const node = get(id);
  if (!node) return [];
  return node.type === "group" ? [node, ...node.children.flatMap((child) => subtreeOf(get, child))] : [node];
}

/** The selected layers that are not inside another selected layer, bottom of the stack first. */
export function topLevelSelection(doc: Doc, ids: readonly NodeId[]): NodeId[] {
  const picked = new Set(ids.filter((id) => doc.nodes[id]));
  const keep = [...picked].filter((id) => {
    for (let p = parentOf(doc, id); p; p = parentOf(doc, p)) if (picked.has(p)) return false;
    return true;
  });
  const order = new Map<NodeId, number>();
  const walk = (list: readonly NodeId[]) =>
    list.forEach((id) => {
      order.set(id, order.size);
      const node = doc.nodes[id];
      if (node?.type === "group") walk(node.children);
    });
  walk(doc.root);
  return keep.sort((a, b) => order.get(a)! - order.get(b)!);
}

export const nodeCap = (doc: Doc): number => (doc.kind === "template" ? LIMITS.templateNodes : LIMITS.designNodes);

export const layerLimit = (doc: Doc): string => `A design can have up to ${nodeCap(doc)} layers.`;
```

- [ ] **Step 4: Create `clipboard.ts` with clone and duplicate**

```ts
import type { Doc, Node, NodeId } from "@vash/schema";
import type { Command } from "./commands";
import { newNodeId } from "./insert";
import type { EditMode } from "./policy";
import { parentOf } from "./scene";
import { layerLimit, nodeCap, refuse, siblingsOf, subtreeOf, topLevelSelection, type Plan } from "./selection-utils";

/** How far a duplicate or a pasted layer lands from the original, in artboard units. */
export const DUPLICATE_OFFSET = 20;

export interface CloneOptions {
  dx: number;
  dy: number;
  /** A user's own copy of a locked template layer is theirs to edit. */
  freeLocks: boolean;
}

/** Copies of `id` and its descendants under fresh ids. Only the top copy is moved by (dx, dy). */
export function cloneSubtree(get: (id: NodeId) => Node | undefined, id: NodeId, o: CloneOptions): Node[] {
  const source = subtreeOf(get, id);
  const fresh = new Map(source.map((n) => [n.id, newNodeId()]));
  return source.map((n): Node => {
    const shared = {
      id: fresh.get(n.id)!,
      transform: n.id === id ? { ...n.transform, x: n.transform.x + o.dx, y: n.transform.y + o.dy } : n.transform,
      lock: o.freeLocks ? ("free" as const) : n.lock,
    };
    return n.type === "group" ? { ...n, ...shared, children: n.children.map((c) => fresh.get(c)!) } : { ...n, ...shared };
  });
}

/** Copies the selected layers to the top of their stacks, a little to the side, and selects the copies. */
export function planDuplicate(doc: Doc, ids: readonly NodeId[], mode: EditMode): Plan {
  const roots = topLevelSelection(doc, ids);
  if (roots.length === 0) return refuse("Select a layer to duplicate.");
  const options = { dx: DUPLICATE_OFFSET, dy: DUPLICATE_OFFSET, freeLocks: mode === "design" };
  const copies = roots.map((id) => cloneSubtree((n) => doc.nodes[n], id, options));
  if (Object.keys(doc.nodes).length + copies.reduce((sum, c) => sum + c.length, 0) > nodeCap(doc)) return refuse(layerLimit(doc));

  const added = new Map<NodeId | null, number>();
  const commands = roots.map((id, i): Command => {
    const parent = parentOf(doc, id);
    const soFar = added.get(parent) ?? 0;
    added.set(parent, soFar + 1);
    return { type: "insert", nodes: copies[i]!, parent, index: siblingsOf(doc, parent).length + soFar };
  });
  return { ok: true, command: { type: "batch", commands }, select: copies.map((c) => c[0]!.id) };
}
```

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm --filter @vash/engine exec vitest run src/duplicate.test.ts`
Expected: PASS (7 tests).

Run: `corepack pnpm --filter @vash/engine typecheck`
Expected: no errors. If TypeScript rejects the two `return` branches in `cloneSubtree`, keep the explicit `: Node` return type and the `n.type === "group"` narrowing; do not cast.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/selection-utils.ts packages/engine/src/clipboard.ts packages/engine/src/duplicate.test.ts
git commit -m "feat(engine): plan duplicating layers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Group and ungroup

**Files:**
- Create: `packages/engine/src/structure.ts`
- Test: `packages/engine/src/structure.test.ts` (create)

**Interfaces:**
- Consumes: `Plan`, `refuse`, `siblingsOf`, `subtreeOf`, `topLevelSelection` (Task 3); `decompose`, `matricesClose`, `fromTransform`, `multiply`, `aabb`, `boxCorners` (Task 2 and `math.ts`); `checkPolicy`, `newNodeId`, `parentOf`.
- Produces: `planGroup(doc: Doc, ids: readonly NodeId[], mode: EditMode): Plan`, `planUngroup(doc: Doc, ids: readonly NodeId[], mode: EditMode): Plan`.

Design: a new group has an identity transform except its translation (the centre of its members' combined box), so children keep their rotation and scale and only shift by minus that centre. Ungroup multiplies the group's matrix into each child, decomposes the result, and refuses if that loses information. Group opacity and visibility are baked into the children because the renderer multiplies them (`render.ts:220`).

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/structure.test.ts`:

```ts
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
    const doc = docWith([rect("a", { x: 100, y: 100 }), rect("b", { x: 300, y: 300, rotation: 30 }), rect("c", { x: 700 })]);
    const plan = ok(planGroup(doc, ["a", "b"], "design"));
    const next = applyCommand(doc, plan.command).doc;
    const g = next.nodes[plan.select[0]!]!;
    expect(g).toMatchObject({ type: "group", children: ["a", "b"], transform: { x: 200, y: 200 }, width: 300, height: 300 });
    expect(next.root).toEqual([g.id, "c"]);
    for (const id of ["a", "b", "c"]) expect(matricesClose(worldMatrix(next, id), worldMatrix(doc, id))).toBe(true);
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --filter @vash/engine exec vitest run src/structure.test.ts`
Expected: FAIL (`./structure` does not exist).

- [ ] **Step 3: Implement `structure.ts`**

```ts
import type { Doc, GroupNode, Node, NodeId } from "@vash/schema";
import type { Command } from "./commands";
import { newNodeId } from "./insert";
import { aabb, boxCorners, decompose, fromTransform, matricesClose, multiply } from "./math";
import { checkPolicy, type EditMode } from "./policy";
import { parentOf } from "./scene";
import { refuse, siblingsOf, subtreeOf, topLevelSelection, type Plan } from "./selection-utils";

const positionOf = (doc: Doc, id: NodeId) => siblingsOf(doc, parentOf(doc, id)).indexOf(id);

/** Turns a plan into a refusal when a lock forbids its commands. */
function allowed(doc: Doc, command: Command, mode: EditMode, select: NodeId[]): Plan {
  const verdict = checkPolicy(doc, command, mode);
  return verdict.ok ? { ok: true, command, select } : refuse(verdict.reason);
}

/**
 * Wraps two or more layers of the same level in a new group. The group only translates (to the centre
 * of its members), so each member keeps its own rotation and scale and stays exactly where it was.
 */
export function planGroup(doc: Doc, ids: readonly NodeId[], mode: EditMode): Plan {
  const roots = topLevelSelection(doc, ids);
  if (roots.length < 2) return refuse("Select two or more layers to group.");
  const parent = parentOf(doc, roots[0]!);
  if (roots.some((id) => parentOf(doc, id) !== parent)) return refuse("Select layers at the same level to group them.");

  const list = siblingsOf(doc, parent);
  const ordered = [...roots].sort((a, b) => list.indexOf(a) - list.indexOf(b));
  const members = ordered.map((id) => doc.nodes[id]!);
  const box = aabb(members.flatMap((n) => boxCorners(n.width, n.height, fromTransform(n.transform))));
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;

  const created: GroupNode = {
    id: newNodeId(),
    type: "group",
    name: "Group",
    transform: { x: cx, y: cy, rotation: 0, scaleX: 1, scaleY: 1 },
    width: Math.max(1, box.maxX - box.minX),
    height: Math.max(1, box.maxY - box.minY),
    opacity: 1,
    visible: true,
    lock: "free",
    children: ordered,
  };
  const moved = ordered.flatMap((id): Node[] => {
    const [top, ...rest] = subtreeOf((n) => doc.nodes[n], id);
    return [{ ...top!, transform: { ...top!.transform, x: top!.transform.x - cx, y: top!.transform.y - cy } }, ...rest];
  });
  const command: Command = {
    type: "batch",
    commands: [
      ...ordered.map((id): Command => ({ type: "delete", id })),
      // Every member sits below the topmost one, and they are all removed first, so the group takes its place.
      { type: "insert", nodes: [created, ...moved], parent, index: list.indexOf(ordered.at(-1)!) - (ordered.length - 1) },
    ],
  };
  return allowed(doc, command, mode, [created.id]);
}

/**
 * Replaces each selected group by its children, in the group's place in the stack. A child's new
 * transform is the group's matrix times its own; if that would need shear the drawing could change,
 * so the whole ungroup is refused.
 */
export function planUngroup(doc: Doc, ids: readonly NodeId[], mode: EditMode): Plan {
  const top = topLevelSelection(doc, ids);
  const groups = top.filter((id) => doc.nodes[id]?.type === "group");
  if (groups.length === 0) return refuse("Select a group to ungroup.");

  const commands: Command[] = [];
  const select = top.filter((id) => !groups.includes(id));
  // Highest position first, so replacing one group never shifts the index of another in the same list.
  for (const id of [...groups].sort((a, b) => positionOf(doc, b) - positionOf(doc, a))) {
    const g = doc.nodes[id] as GroupNode;
    const parent = parentOf(doc, id);
    const at = positionOf(doc, id);
    const groupMatrix = fromTransform(g.transform);
    const lifted: Node[][] = [];
    for (const childId of g.children) {
      const child = doc.nodes[childId];
      if (!child) continue;
      const m = multiply(groupMatrix, fromTransform(child.transform));
      const transform = decompose(m);
      if (!matricesClose(fromTransform(transform), m)) return refuse("This group is stretched too far to ungroup.");
      const [self, ...rest] = subtreeOf((n) => doc.nodes[n], childId);
      lifted.push([{ ...self!, transform, opacity: self!.opacity * g.opacity, visible: self!.visible && g.visible }, ...rest]);
    }
    commands.push({ type: "delete", id }, ...lifted.map((nodes, i): Command => ({ type: "insert", nodes, parent, index: at + i })));
    select.push(...lifted.map((nodes) => nodes[0]!.id));
  }
  return allowed(doc, { type: "batch", commands }, mode, select);
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @vash/engine exec vitest run src/structure.test.ts`
Expected: PASS (11 tests).

Run: `corepack pnpm --filter @vash/engine typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/structure.ts packages/engine/src/structure.test.ts
git commit -m "feat(engine): plan grouping and ungrouping layers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Copy and paste plans

**Files:**
- Modify: `packages/engine/src/clipboard.ts` (add imports and the code below)
- Test: `packages/engine/src/clipboard.test.ts` (create)

**Interfaces:**
- Consumes: everything `clipboard.ts` already has, `LIMITS`, `cloneSubtree`.
- Produces: `CLIPBOARD_PREFIX = "vash:"`, `serializeSelection(doc: Doc, ids: readonly NodeId[]): string | null`, `planPaste(doc: Doc, text: string, mode: EditMode): Plan` (adds to the document root, offset, selects the pasted layers; the `notice` field says when photos were left out).

`planPaste` never trusts the text: it cleans the shape it needs to clone, and the final structural validation is done by `runPlan` in Task 6 (`validateDoc`).

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/clipboard.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --filter @vash/engine exec vitest run src/clipboard.test.ts`
Expected: FAIL (`serializeSelection`, `planPaste`, `CLIPBOARD_PREFIX` are not exported).

- [ ] **Step 3: Implement**

In `packages/engine/src/clipboard.ts`, change the first import line to also import `LIMITS`:

```ts
import { LIMITS, type Doc, type Node, type NodeId } from "@vash/schema";
```

Append:

```ts
/** Copied layers travel as text, so they work across tabs and the system clipboard. */
export const CLIPBOARD_PREFIX = "vash:";

const NOTHING_TO_PASTE = "Nothing to paste.";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The selected layers (top-level ones, with their descendants) as clipboard text, or null for an empty selection. */
export function serializeSelection(doc: Doc, ids: readonly NodeId[]): string | null {
  const roots = topLevelSelection(doc, ids);
  if (roots.length === 0) return null;
  const nodes = roots.flatMap((id) => subtreeOf((n) => doc.nodes[n], id));
  return CLIPBOARD_PREFIX + JSON.stringify({ v: 1, roots, nodes });
}

function parsePayload(text: string): { roots: NodeId[]; nodes: Node[] } | null {
  if (!text.startsWith(CLIPBOARD_PREFIX) || text.length > LIMITS.docBytes) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(CLIPBOARD_PREFIX.length));
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.roots) || !Array.isArray(raw.nodes) || raw.roots.length === 0) return null;
  if (!raw.roots.every((r) => typeof r === "string") || !raw.nodes.every((n) => isRecord(n) && typeof n.id === "string")) return null;
  return { roots: raw.roots as NodeId[], nodes: raw.nodes as Node[] };
}

/**
 * Pastes clipboard text at the top of the root, a little to the side. The text is untrusted: layers
 * that need a photo or sticker this design does not already use are left out (and the notice says so),
 * and `runPlan` validates the whole result before anything is applied.
 */
export function planPaste(doc: Doc, text: string, mode: EditMode): Plan {
  const payload = parsePayload(text);
  if (!payload) return refuse(NOTHING_TO_PASTE);
  const byId = new Map<NodeId, Node>();
  for (const n of payload.nodes) {
    if (byId.has(n.id)) return refuse(NOTHING_TO_PASTE);
    byId.set(n.id, n);
  }

  let dropped = 0;
  const known = (assetId: unknown) => typeof assetId === "string" && Object.hasOwn(doc.assets, assetId);
  // The layer and its descendants with unusable ones removed; null when nothing is left of it.
  const prune = (id: NodeId, path: ReadonlySet<NodeId>): Node[] | null => {
    const n = byId.get(id);
    if (!n || path.has(id)) return null;
    if (n.type === "group") {
      if (!Array.isArray(n.children)) return null;
      const inside = new Set(path).add(id);
      const kept = n.children.map((child) => prune(child, inside)).filter((k): k is Node[] => k !== null);
      return kept.length === 0 ? null : [{ ...n, children: kept.map((k) => k[0]!.id) }, ...kept.flat()];
    }
    const usesAsset = n.type === "sticker" || (n.type === "frame" && n.content != null);
    const assetId = n.type === "sticker" ? n.assetId : n.type === "frame" ? n.content?.assetId : undefined;
    if (usesAsset && !known(assetId)) {
      dropped++;
      return null;
    }
    return [n];
  };

  const kept = payload.roots.map((id) => prune(id, new Set())).filter((k): k is Node[] => k !== null);
  if (kept.length === 0) return refuse(dropped > 0 ? "Photos can only be pasted into a design that already uses them." : NOTHING_TO_PASTE);

  const local = new Map(kept.flat().map((n) => [n.id, n] as const));
  let copies: Node[][];
  try {
    copies = kept.map((nodes) => cloneSubtree((id) => local.get(id), nodes[0]!.id, { dx: DUPLICATE_OFFSET, dy: DUPLICATE_OFFSET, freeLocks: mode === "design" }));
  } catch {
    return refuse(NOTHING_TO_PASTE); // a node with missing or malformed fields
  }
  if (Object.keys(doc.nodes).length + copies.reduce((sum, c) => sum + c.length, 0) > nodeCap(doc)) return refuse(layerLimit(doc));

  const command: Command = {
    type: "batch",
    commands: copies.map((nodes, i): Command => ({ type: "insert", nodes, parent: null, index: doc.root.length + i })),
  };
  const notice = dropped > 0 ? "Some photos weren't pasted because this design doesn't use them." : undefined;
  return { ok: true, command, select: copies.map((c) => c[0]!.id), ...(notice ? { notice } : {}) };
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @vash/engine exec vitest run src/clipboard.test.ts src/duplicate.test.ts`
Expected: PASS.

Run: `corepack pnpm --filter @vash/engine typecheck`
Expected: no errors. (The comparisons on hostile data, such as `n.content != null` and `Array.isArray(n.children)`, are intentional: JSON is untyped at runtime.)

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/clipboard.ts packages/engine/src/clipboard.test.ts
git commit -m "feat(engine): copy layers to text and plan pasting them back" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Apply plans, shortcuts and the engine API

**Files:**
- Create: `packages/engine/src/edit-ops.ts`
- Modify: `packages/engine/src/shortcuts.ts:28-37`
- Modify: `packages/engine/src/editor.ts:53-54`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/edit-ops.test.ts`, `packages/engine/src/shortcuts-edit.test.ts` (create both)

**Interfaces:**
- Consumes: `planDuplicate`, `planPaste`, `serializeSelection` (Tasks 3, 5); `planGroup`, `planUngroup` (Task 4); `EditorCore`.
- Produces (`edit-ops.ts`):
  - `INVALID_CHANGE: string`
  - `runPlan(core: EditorCore, plan: Plan): boolean` (refusal or invalid result sets `core.setChrome({ notice })` and returns false; otherwise validates, dispatches as one undo step, selects, shows `plan.notice`)
  - `duplicateSelection(core): boolean`, `groupSelection(core): boolean`, `ungroupSelection(core): boolean`
  - `copySelection(core): string | null`, `cutSelection(core): string | null` (null when nothing selected or a lock refuses the delete), `pasteText(core, text: string): boolean`
- Produces (`index.ts`): all of the above plus `planDuplicate`, `planGroup`, `planUngroup`, `CLIPBOARD_PREFIX`, `type Plan`.

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/src/edit-ops.test.ts`:

```ts
import { LIMITS } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { serializeSelection } from "./clipboard";
import { EditorCore } from "./editor-core";
import { copySelection, cutSelection, duplicateSelection, groupSelection, pasteText, ungroupSelection } from "./edit-ops";
import { docWith, rect } from "./test-docs";

const setup = () => new EditorCore(docWith([rect("a", { x: 100, y: 100 }), rect("b", { x: 300, y: 300 }), { ...rect("locked", { x: 500 }), lock: "locked" }]));
const tamper = (text: string, edit: (node: Record<string, unknown>) => void) => {
  const body = JSON.parse(text.slice("vash:".length));
  edit(body.nodes[0]);
  return `vash:${JSON.stringify(body)}`;
};

describe("duplicateSelection, groupSelection, ungroupSelection", () => {
  it("duplicates, selects the copy and undoes in one step", () => {
    const core = setup();
    core.select(["a"]);
    expect(duplicateSelection(core)).toBe(true);
    expect(core.doc.root).toHaveLength(4);
    expect(core.getState().selection).toEqual([core.doc.root.at(-1)]);
    core.undo();
    expect(core.doc.root).toHaveLength(3);
  });

  it("groups, then ungroups, keeping each step undoable", () => {
    const core = setup();
    core.select(["a", "b"]);
    expect(groupSelection(core)).toBe(true);
    const [g] = core.getState().selection;
    expect(core.doc.nodes[g!]!.type).toBe("group");
    expect(ungroupSelection(core)).toBe(true);
    expect(core.doc.root).toEqual(["a", "b", "locked"]);
    core.undo();
    expect(core.doc.nodes[g!]).toBeDefined();
  });

  it("refuses to group a locked layer and says why (Review Focus 4)", () => {
    const core = setup();
    core.select(["a", "locked"]);
    expect(groupSelection(core)).toBe(false);
    expect(core.getState().notice).toMatch(/locked/i);
    expect(core.doc.root).toEqual(["a", "b", "locked"]);
  });

  it("refuses to duplicate at the layer cap with a message, not an invalid design (Review Focus 3)", () => {
    const core = new EditorCore(docWith(Array.from({ length: LIMITS.designNodes }, (_, i) => rect(`r${i}`, {}))));
    core.select(["r0"]);
    expect(duplicateSelection(core)).toBe(false);
    expect(core.getState().notice).toMatch(/up to 500 layers/);
    expect(Object.keys(core.doc.nodes)).toHaveLength(LIMITS.designNodes);
  });
});

describe("copy, cut and paste", () => {
  it("copies without changing the design", () => {
    const core = setup();
    core.select(["a"]);
    const before = core.doc;
    expect(copySelection(core)).toMatch(/^vash:/);
    expect(core.doc).toBe(before);
  });

  it("cuts, then pastes back as separate undo steps", () => {
    const core = setup();
    core.select(["a"]);
    const text = cutSelection(core)!;
    expect(core.doc.nodes.a).toBeUndefined();
    expect(pasteText(core, text)).toBe(true);
    expect(Object.keys(core.doc.nodes)).toHaveLength(3);
    core.undo();
    expect(core.doc.root).toEqual(["b", "locked"]);
    core.undo();
    expect(core.doc.root).toEqual(["a", "b", "locked"]);
  });

  it("does not cut a locked layer and puts nothing on the clipboard (Review Focus 4)", () => {
    const core = setup();
    core.select(["locked"]);
    expect(cutSelection(core)).toBeNull();
    expect(core.doc.nodes.locked).toBeDefined();
    expect(core.getState().notice).toMatch(/locked/i);
  });

  it("refuses text that is not a payload, with a message (Review Focus 1)", () => {
    const core = setup();
    expect(pasteText(core, "hello")).toBe(false);
    expect(core.getState().notice).toBe("Nothing to paste.");
  });

  it("refuses a payload that would make the design invalid, and changes nothing (Review Focus 1)", () => {
    const core = setup();
    const text = serializeSelection(core.doc, ["a"])!;
    const before = core.doc;
    for (const edit of [
      (n: Record<string, unknown>) => (n.evil = 1),
      (n: Record<string, unknown>) => (n.width = 1e9),
      (n: Record<string, unknown>) => (n.type = "banana"),
      (n: Record<string, unknown>) => (n.opacity = "high"),
    ]) {
      expect(pasteText(core, tamper(text, edit))).toBe(false);
      expect(core.doc).toBe(before);
    }
    expect(core.getState().notice).toMatch(/invalid/i);
  });

  it("does not let a __proto__ key pollute anything (Review Focus 1)", () => {
    const core = setup();
    const text = serializeSelection(core.doc, ["a"])!;
    const hostile = text.replace(/^vash:\{/, 'vash:{"__proto__":{"polluted":true},').replace(/"id":"a"/, '"__proto__":{"polluted":true},"id":"a"');
    pasteText(core, hostile);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(core.doc.root).toEqual(["a", "b", "locked"]);
  });
});
```

Create `packages/engine/src/shortcuts-edit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EditorCore } from "./editor-core";
import { handleKey, type KeyInput } from "./shortcuts";
import { docWith, rect } from "./test-docs";

const key = (k: string, o: Partial<KeyInput> = {}): KeyInput => ({ key: k, mod: false, shift: false, alt: false, ...o });
const setup = () => new EditorCore(docWith([rect("a", { x: 100 }), rect("b", { x: 300 })]));

describe("editing shortcuts", () => {
  it("Ctrl+D duplicates the selection", () => {
    const c = setup();
    c.select(["a"]);
    expect(handleKey(c, key("d", { mod: true }))).toBe(true);
    expect(c.doc.root).toHaveLength(3);
  });

  it("Ctrl+G groups and Ctrl+Shift+G ungroups", () => {
    const c = setup();
    c.select(["a", "b"]);
    expect(handleKey(c, key("g", { mod: true }))).toBe(true);
    expect(c.doc.root).toHaveLength(1);
    expect(handleKey(c, key("G", { mod: true, shift: true }))).toBe(true);
    expect(c.doc.root).toEqual(["a", "b"]);
  });

  it("uses the key even with nothing selected, so the browser's bookmark and find shortcuts stay quiet", () => {
    const c = setup();
    expect(handleKey(c, key("d", { mod: true }))).toBe(true);
    expect(c.getState().notice).toBe("Select a layer to duplicate.");
    expect(handleKey(c, key("g", { mod: true }))).toBe(true);
  });

  it("leaves Ctrl+Shift+D and Ctrl+Alt+G to the browser", () => {
    const c = setup();
    c.select(["a"]);
    expect(handleKey(c, key("d", { mod: true, shift: true }))).toBe(false);
    expect(handleKey(c, key("g", { mod: true, alt: true }))).toBe(false);
    expect(c.doc.root).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm --filter @vash/engine exec vitest run src/edit-ops.test.ts src/shortcuts-edit.test.ts`
Expected: FAIL (`./edit-ops` does not exist).

- [ ] **Step 3: Create `edit-ops.ts`**

```ts
import { validateDoc } from "@vash/schema";
import { applyCommand, type Command } from "./commands";
import { planDuplicate, planPaste, serializeSelection } from "./clipboard";
import type { EditorCore } from "./editor-core";
import { topLevelSelection, type Plan } from "./selection-utils";
import { planGroup, planUngroup } from "./structure";

export const INVALID_CHANGE = "That change would make the design invalid, so it wasn't made.";

/**
 * Applies a plan as one undo step and selects its result. A refused plan, or one whose result would
 * not pass the document validator, changes nothing and leaves a notice for the UI.
 */
export function runPlan(core: EditorCore, plan: Plan): boolean {
  if (!plan.ok) {
    core.setChrome({ notice: plan.reason });
    return false;
  }
  const result = validateDoc(applyCommand(core.doc, plan.command).doc, { kind: core.doc.kind });
  if (!result.ok) {
    core.setChrome({ notice: INVALID_CHANGE });
    return false;
  }
  if (!core.dispatch(plan.command)) return false;
  core.select(plan.select);
  if (plan.notice) core.setChrome({ notice: plan.notice });
  return true;
}

export const duplicateSelection = (core: EditorCore): boolean => runPlan(core, planDuplicate(core.doc, core.getState().selection, core.mode));
export const groupSelection = (core: EditorCore): boolean => runPlan(core, planGroup(core.doc, core.getState().selection, core.mode));
export const ungroupSelection = (core: EditorCore): boolean => runPlan(core, planUngroup(core.doc, core.getState().selection, core.mode));
export const pasteText = (core: EditorCore, text: string): boolean => runPlan(core, planPaste(core.doc, text, core.mode));

/** Clipboard text for the selection, or null when nothing is selected. */
export const copySelection = (core: EditorCore): string | null => serializeSelection(core.doc, core.getState().selection);

/** Copies, then deletes. Returns null (and copies nothing) when there is no selection or a lock refuses the delete. */
export function cutSelection(core: EditorCore): string | null {
  const { selection } = core.getState();
  const text = serializeSelection(core.doc, selection);
  if (!text) return null;
  const deletes = topLevelSelection(core.doc, selection).map((id): Command => ({ type: "delete", id }));
  return core.dispatch({ type: "batch", commands: deletes }) ? text : null;
}
```

- [ ] **Step 4: Add the shortcuts**

In `packages/engine/src/shortcuts.ts`, add to the imports:

```ts
import { duplicateSelection, groupSelection, ungroupSelection } from "./edit-ops";
```

and insert this block right after the Ctrl+A block (before `if (e.key === "Escape")`):

```ts
  // With nothing selected these still count as used, so the browser's bookmark (D) and find (G) stay quiet.
  if (e.mod && !e.alt && k === "d" && !e.shift) {
    duplicateSelection(core);
    return true;
  }
  if (e.mod && !e.alt && k === "g") {
    if (e.shift) ungroupSelection(core);
    else groupSelection(core);
    return true;
  }
```

- [ ] **Step 5: Ignore design shortcuts inside dialogs**

In `packages/engine/src/editor.ts`, replace:

```ts
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
```

with:

```ts
/** Keys typed into a field, or pressed while a dialog is open, belong to that field or dialog. */
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.closest("dialog") !== null);
```

(This is DOM-only, so it is checked in the browser in Task 16, not here.)

- [ ] **Step 6: Export the API**

In `packages/engine/src/index.ts`, add after the `insert` export line:

```ts
export { CLIPBOARD_PREFIX, planDuplicate } from "./clipboard";
export { planGroup, planUngroup } from "./structure";
export { INVALID_CHANGE, copySelection, cutSelection, duplicateSelection, groupSelection, pasteText, runPlan, ungroupSelection } from "./edit-ops";
export { topLevelSelection, type Plan } from "./selection-utils";
```

- [ ] **Step 7: Run everything in the engine**

Run: `corepack pnpm --filter @vash/engine test`
Expected: all tests pass, including the existing `shortcuts.test.ts`.

Run: `corepack pnpm --filter @vash/engine typecheck` and `corepack pnpm --filter @vash/engine lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src
git commit -m "feat(engine): duplicate, group, ungroup, cut, copy and paste with shortcuts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Small pure helpers for the web app

**Files:**
- Create: `apps/web/src/lib/title.ts`, `apps/web/src/lib/zoom-slider.ts`, `apps/web/src/lib/menu-position.ts`, `apps/web/src/lib/design-info.ts`
- Test: `apps/web/src/lib/title.test.ts`, `zoom-slider.test.ts`, `menu-position.test.ts`, `design-info.test.ts` (create all four)

**Interfaces:**
- Produces:
  - `normalizeTitle(input: string): { ok: true; title: string } | { ok: false; reason: string }`
  - `SLIDER_STEPS: number`, `zoomToSlider(zoom: number): number`, `sliderToZoom(value: number): number`
  - `clampMenuPosition(at: { x: number; y: number }, size: { width: number; height: number }, view: { width: number; height: number }, margin?: number): { x: number; y: number }`
  - `describeDesign(doc: Doc, savedAt: string, locale?: string): { label: string; value: string }[]`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/title.test.ts`:

```ts
import { LIMITS } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { normalizeTitle } from "./title";

describe("normalizeTitle", () => {
  it("trims the name", () => {
    expect(normalizeTitle("  Summer sale  ")).toEqual({ ok: true, title: "Summer sale" });
  });

  it("turns newlines and control characters into spaces (Review Focus 5)", () => {
    expect(normalizeTitle("Sale\nweek\t2")).toEqual({ ok: true, title: "Sale week 2" });
  });

  it("refuses an empty or whitespace-only name (Review Focus 5)", () => {
    expect(normalizeTitle("")).toEqual({ ok: false, reason: "Give your design a name." });
    expect(normalizeTitle(" \n\t ")).toEqual({ ok: false, reason: "Give your design a name." });
  });

  it("allows exactly the schema's limit and refuses one more (Review Focus 5)", () => {
    expect(normalizeTitle("a".repeat(LIMITS.titleChars)).ok).toBe(true);
    const over = normalizeTitle("a".repeat(LIMITS.titleChars + 1));
    expect(over).toEqual({ ok: false, reason: `Names can be up to ${LIMITS.titleChars} characters.` });
  });
});
```

`apps/web/src/lib/zoom-slider.test.ts`:

```ts
import { ZOOM_MAX, ZOOM_MIN } from "@vash/engine";
import { describe, expect, it } from "vitest";
import { SLIDER_STEPS, sliderToZoom, zoomToSlider } from "./zoom-slider";

describe("zoom slider", () => {
  it("maps the ends of the slider to the zoom limits", () => {
    expect(sliderToZoom(0)).toBeCloseTo(ZOOM_MIN);
    expect(sliderToZoom(SLIDER_STEPS)).toBeCloseTo(ZOOM_MAX);
    expect(zoomToSlider(ZOOM_MIN)).toBe(0);
    expect(zoomToSlider(ZOOM_MAX)).toBe(SLIDER_STEPS);
  });

  it("round-trips within one percent", () => {
    for (const z of [0.1, 0.5, 1, 2, 4]) expect(sliderToZoom(zoomToSlider(z)) / z).toBeCloseTo(1, 1);
  });

  it("clamps values outside the range and survives bad input", () => {
    expect(zoomToSlider(100)).toBe(SLIDER_STEPS);
    expect(zoomToSlider(0.0001)).toBe(0);
    expect(zoomToSlider(Number.NaN)).toBe(0);
    expect(sliderToZoom(-5)).toBeCloseTo(ZOOM_MIN);
    expect(sliderToZoom(SLIDER_STEPS * 2)).toBeCloseTo(ZOOM_MAX);
  });
});
```

`apps/web/src/lib/menu-position.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampMenuPosition } from "./menu-position";

const view = { width: 1000, height: 700 };
const size = { width: 220, height: 300 };

describe("clampMenuPosition", () => {
  it("leaves a menu that fits where it was opened", () => {
    expect(clampMenuPosition({ x: 100, y: 100 }, size, view)).toEqual({ x: 100, y: 100 });
  });

  it("moves a menu that would run off the right or bottom edge back on screen", () => {
    expect(clampMenuPosition({ x: 950, y: 650 }, size, view)).toEqual({ x: 1000 - 220 - 8, y: 700 - 300 - 8 });
  });

  it("keeps a margin from the top and left, and copes with a window smaller than the menu", () => {
    expect(clampMenuPosition({ x: -20, y: 2 }, size, view)).toEqual({ x: 8, y: 8 });
    expect(clampMenuPosition({ x: 50, y: 50 }, size, { width: 100, height: 100 })).toEqual({ x: 8, y: 8 });
  });
});
```

`apps/web/src/lib/design-info.test.ts`:

```ts
import { createEmptyDoc } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { describeDesign } from "./design-info";

const doc = createEmptyDoc({ id: "d1", kind: "design", title: "Test", format: "ig-post" });

describe("describeDesign", () => {
  it("lists the size, format, layer count and last save", () => {
    const rows = describeDesign(doc, "2026-09-29T10:15:00.000Z", "en-US");
    expect(rows.map((r) => r.label)).toEqual(["Size", "Format", "Layers", "Last saved"]);
    expect(rows[0]!.value).toBe(`${doc.artboard.width} × ${doc.artboard.height} px`);
    expect(rows[1]!.value).toBe("Post");
    expect(rows[2]!.value).toBe("0");
    expect(rows[3]!.value).toMatch(/2026/);
  });

  it("says so when the save time is unknown", () => {
    expect(describeDesign(doc, "not a date")[3]!.value).toBe("Not saved yet");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `corepack pnpm --filter @vash/web exec vitest run src/lib/title.test.ts src/lib/zoom-slider.test.ts src/lib/menu-position.test.ts src/lib/design-info.test.ts`
Expected: FAIL (modules do not exist).

- [ ] **Step 3: Implement**

`apps/web/src/lib/title.ts`:

```ts
import { LIMITS } from "@vash/schema";

export type TitleResult = { ok: true; title: string } | { ok: false; reason: string };

/** Cleans a typed design name and checks it against the schema's limits. */
export function normalizeTitle(input: string): TitleResult {
  const title = input.replace(/\p{Cc}+/gu, " ").trim();
  if (title.length === 0) return { ok: false, reason: "Give your design a name." };
  if (title.length > LIMITS.titleChars) return { ok: false, reason: `Names can be up to ${LIMITS.titleChars} characters.` };
  return { ok: true, title };
}
```

`apps/web/src/lib/zoom-slider.ts`:

```ts
import { ZOOM_MAX, ZOOM_MIN } from "@vash/engine";

/** Zoom spans 5% to 800%, so the slider is logarithmic: each step is the same percentage change. */
export const SLIDER_STEPS = 1000;

const span = Math.log(ZOOM_MAX / ZOOM_MIN);

export function zoomToSlider(zoom: number): number {
  if (!Number.isFinite(zoom)) return 0;
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  return Math.round((Math.log(z / ZOOM_MIN) / span) * SLIDER_STEPS);
}

export function sliderToZoom(value: number): number {
  const v = Math.min(SLIDER_STEPS, Math.max(0, value));
  return ZOOM_MIN * Math.exp((v / SLIDER_STEPS) * span);
}
```

`apps/web/src/lib/menu-position.ts`:

```ts
interface Size {
  width: number;
  height: number;
}

/** Where to draw a menu opened at `at` so it stays inside the window, with a margin on every side. */
export function clampMenuPosition(at: { x: number; y: number }, size: Size, view: Size, margin = 8): { x: number; y: number } {
  return {
    x: Math.max(margin, Math.min(at.x, view.width - size.width - margin)),
    y: Math.max(margin, Math.min(at.y, view.height - size.height - margin)),
  };
}
```

`apps/web/src/lib/design-info.ts`:

```ts
import type { Doc } from "@vash/schema";
import { formatLabel } from "./designs";

/** The facts the Design info dialog shows. Only things the app really knows. */
export function describeDesign(doc: Doc, savedAt: string, locale?: string): { label: string; value: string }[] {
  const saved = new Date(savedAt);
  return [
    { label: "Size", value: `${doc.artboard.width} × ${doc.artboard.height} px` },
    { label: "Format", value: formatLabel(doc.meta.format) },
    { label: "Layers", value: String(Object.keys(doc.nodes).length) },
    { label: "Last saved", value: Number.isNaN(saved.getTime()) ? "Not saved yet" : saved.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) },
  ];
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @vash/web exec vitest run src/lib`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/title.ts apps/web/src/lib/zoom-slider.ts apps/web/src/lib/menu-position.ts apps/web/src/lib/design-info.ts apps/web/src/lib/title.test.ts apps/web/src/lib/zoom-slider.test.ts apps/web/src/lib/menu-position.test.ts apps/web/src/lib/design-info.test.ts
git commit -m "feat(web): helpers for rename, zoom slider, menu position and design info" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Menu supports shortcuts and disabled items

**Files:**
- Modify: `apps/web/src/components/ui/menu.tsx` (replace the whole file)

**Interfaces:**
- Produces: `MenuItem` gains optional `shortcut?: string` and `disabled?: string` (the reason; the item stays visible, dimmed, focusable and inert). New exports `MENU_PANEL: string` (panel classes), `MenuItems({ items, onDone })`, `moveMenuFocus(e: KeyboardEvent, list: HTMLElement | null): void`. Existing `Menu` callers keep working unchanged.

There is no unit test (a client component; the web tests run in node). Correctness is checked by `typecheck`, `lint`, the existing menus that still render (Designs page, Task 16) and the new menus in Task 13.

- [ ] **Step 1: Replace `apps/web/src/components/ui/menu.tsx`**

```tsx
"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type MenuItem =
  | {
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      danger?: boolean;
      /** Shown on the right, for example "Ctrl+D". */
      shortcut?: string;
      /** Why the item can't be used right now. The item stays visible, dimmed, and does nothing. */
      disabled?: string;
    }
  | "separator";

type TriggerProps = {
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string;
  onClick: () => void;
};

/** The look shared by dropdown menus and the right-click menu. */
export const MENU_PANEL = "min-w-[220px] rounded-2xl bg-bg p-1.5 shadow-[0_0_0_.5px_var(--line),0_12px_32px_rgba(0,0,0,.16)]";

/** Up and Down arrows move focus between the items of an open menu, wrapping around. */
export function moveMenuFocus(e: KeyboardEvent, list: HTMLElement | null): void {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const all = [...(list?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
  const at = all.indexOf(document.activeElement as HTMLElement);
  all[(at + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
}

/** The rows of a menu. `onDone` runs before an enabled item's action, to close the menu. */
export function MenuItems({ items, onDone }: { items: MenuItem[]; onDone: () => void }) {
  return (
    <>
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={`sep-${i}`} role="separator" className="mx-2 my-1 h-[.5px] bg-line" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            aria-disabled={item.disabled ? true : undefined}
            title={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onDone();
              item.onSelect();
            }}
            className={cn(
              "flex h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-sm outline-none hover:bg-field focus-visible:bg-field",
              item.danger && "text-danger",
              item.disabled && "opacity-45 hover:bg-transparent",
            )}
          >
            {item.icon}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <span className="text-[12px] text-muted">{item.shortcut}</span>}
          </button>
        ),
      )}
    </>
  );
}

/** A small dropdown menu: Escape or an outside click closes it, arrow keys move between items. */
export function Menu({
  trigger,
  items,
  align = "end",
  side = "bottom",
  className,
}: {
  trigger: (props: TriggerProps) => ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  side?: "top" | "bottom";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      root.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
      return;
    }
    moveMenuFocus(e, list.current);
  };

  return (
    <div ref={root} className={cn("relative", className)} onKeyDown={onKeyDown}>
      {trigger({ "aria-haspopup": "menu", "aria-expanded": open, "aria-controls": id, onClick: () => setOpen((o) => !o) })}
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          className={cn("absolute z-40", MENU_PANEL, align === "end" ? "right-0" : "left-0", side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5")}
        >
          <MenuItems items={items} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `corepack pnpm --filter @vash/web typecheck` and `corepack pnpm --filter @vash/web lint`
Expected: clean. (Existing `Menu` callers in `designs-view.tsx` and the editor pass only `label`, `icon`, `onSelect`, `danger`, so they still compile.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/menu.tsx
git commit -m "feat(web): menu items can show shortcuts and be disabled with a reason" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The action registry

**Files:**
- Create: `apps/web/src/components/editor/editor-actions.ts`
- Test: `apps/web/src/components/editor/editor-actions.test.ts` (create)

**Interfaces:**
- Consumes: engine `checkPolicy`, `duplicateSelection`, `groupSelection`, `handleKey`, `planDuplicate`, `planGroup`, `planUngroup`, `ungroupSelection`, `ZOOM_MAX`, `ZOOM_MIN`, `EditorCore`, `EditorState`, `Plan`, `Command`; `MenuItem` (type only) from `@/components/ui/menu`.
- Produces:
  - `ACTION_IDS` (const array) and `type ActionId`
  - `interface Action { id: ActionId; label: string; shortcut?: string; disabled?: string; hidden?: boolean; run: () => void }`
  - `interface ActionHost { panelsHidden: boolean; canFullscreen: boolean; copy(): void; cut(): void; paste(): void; newDesign(): void; open(): void; makeCopy(): void; rename(): void; moveToFolder(): void; designInfo(): void; save(): void; download(): void; zoomIn(): void; zoomOut(): void; fit(): void; fullscreen(): void; togglePanels(): void; shortcuts(): void }`
  - `buildActions(state: EditorState, core: EditorCore, host: ActionHost): Record<ActionId, Action>`
  - `MENUS: { file; edit; view; help }` and `CONTEXT_LAYOUTS: { node; canvas }` (arrays of `ActionId | "separator"`)
  - `toMenuItems(actions: Record<ActionId, Action>, layout: readonly (ActionId | "separator")[], mac: boolean): MenuItem[]`
  - `formatShortcut(spec: string, mac: boolean): string`
  - `SHORTCUT_ACTIONS: readonly ActionId[]`, `OTHER_SHORTCUTS: readonly { spec: string; does: string }[]`

`shortcut` strings are specs such as `"mod+shift+g"`. The keyboard itself is handled by the engine (`handleKey`) and the clipboard events (Task 10); the registry only reports them, and its `run` functions call the same engine functions.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/editor/editor-actions.test.ts`:

```ts
import { EditorCore, ZOOM_MAX } from "@vash/engine";
import { createEmptyDoc, type Doc, type ShapeNode } from "@vash/schema";
import { describe, expect, it, vi } from "vitest";
import { ACTION_IDS, buildActions, CONTEXT_LAYOUTS, formatShortcut, MENUS, toMenuItems, type ActionHost } from "./editor-actions";

function rect(id: string, x: number, lock: ShapeNode["lock"] = "free"): ShapeNode {
  return {
    id,
    type: "shape",
    name: id,
    transform: { x, y: 100, rotation: 0, scaleX: 1, scaleY: 1 },
    width: 100,
    height: 100,
    opacity: 1,
    visible: true,
    lock,
    geometry: { kind: "rect", cornerRadius: 0 },
    fill: { type: "solid", color: "#FF0000" },
    stroke: null,
  };
}

function docOf(nodes: ShapeNode[]): Doc {
  const doc = createEmptyDoc({ id: "d1", kind: "design", title: "Test", format: "custom", size: { width: 1000, height: 1000 } });
  for (const n of nodes) doc.nodes[n.id] = n;
  doc.root = nodes.map((n) => n.id);
  return doc;
}

const host = (over: Partial<ActionHost> = {}): ActionHost => ({
  panelsHidden: false,
  canFullscreen: true,
  copy: vi.fn(),
  cut: vi.fn(),
  paste: vi.fn(),
  newDesign: vi.fn(),
  open: vi.fn(),
  makeCopy: vi.fn(),
  rename: vi.fn(),
  moveToFolder: vi.fn(),
  designInfo: vi.fn(),
  save: vi.fn(),
  download: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  fit: vi.fn(),
  fullscreen: vi.fn(),
  togglePanels: vi.fn(),
  shortcuts: vi.fn(),
  ...over,
});
const actionsFor = (core: EditorCore, h = host()) => buildActions(core.getState(), core, h);

describe("formatShortcut", () => {
  it("spells out modifiers on Windows and Linux", () => {
    expect(formatShortcut("mod+shift+g", false)).toBe("Ctrl+Shift+G");
    expect(formatShortcut("delete", false)).toBe("Delete");
    expect(formatShortcut("shift+arrows", false)).toBe("Shift+Arrow keys");
  });

  it("uses symbols on a Mac", () => {
    expect(formatShortcut("mod+shift+g", true)).toBe("⌘⇧G");
    expect(formatShortcut("mod+s", true)).toBe("⌘S");
  });
});

describe("the registry", () => {
  it("has an action for every id, and every menu entry is one of them (no dead items)", () => {
    const actions = actionsFor(new EditorCore(docOf([rect("a", 100)])));
    for (const id of ACTION_IDS) {
      expect(actions[id], id).toBeDefined();
      expect(typeof actions[id].run, id).toBe("function");
    }
    for (const layout of [...Object.values(MENUS), ...Object.values(CONTEXT_LAYOUTS)]) {
      for (const entry of layout) if (entry !== "separator") expect(ACTION_IDS, entry).toContain(entry);
    }
  });

  it("disables what needs a selection, with a reason", () => {
    const a = actionsFor(new EditorCore(docOf([rect("a", 100)])));
    for (const id of ["copy", "cut", "delete", "duplicate", "group", "ungroup"] as const) expect(a[id].disabled, id).toBeTruthy();
    expect(a.copy.disabled).toBe("Select a layer first.");
    expect(a.paste.disabled).toBeUndefined();
  });

  it("enables editing actions for a selection and grouping for two layers", () => {
    const core = new EditorCore(docOf([rect("a", 100), rect("b", 300)]));
    core.select(["a"]);
    const one = actionsFor(core);
    expect(one.copy.disabled).toBeUndefined();
    expect(one.duplicate.disabled).toBeUndefined();
    expect(one.group.disabled).toMatch(/two or more/);
    core.select(["a", "b"]);
    expect(actionsFor(core).group.disabled).toBeUndefined();
  });

  it("refuses cut and delete on a locked layer with the template's reason (Review Focus 4)", () => {
    const core = new EditorCore(docOf([rect("locked", 100, "locked")]));
    core.select(["locked"]);
    const a = actionsFor(core);
    expect(a.cut.disabled).toMatch(/locked/i);
    expect(a.delete.disabled).toMatch(/locked/i);
    expect(a.copy.disabled).toBeUndefined();
  });

  it("tracks undo and redo", () => {
    const core = new EditorCore(docOf([rect("a", 100)]));
    expect(actionsFor(core).undo.disabled).toBe("Nothing to undo.");
    core.dispatch({ type: "meta", patch: { title: "New" } });
    expect(actionsFor(core).undo.disabled).toBeUndefined();
    expect(actionsFor(core).redo.disabled).toBe("Nothing to redo.");
  });

  it("disables zoom in at the largest zoom", () => {
    const core = new EditorCore(docOf([]));
    core.setChrome({ viewport: { zoom: ZOOM_MAX, panX: 0, panY: 0 } });
    expect(actionsFor(core).zoomIn.disabled).toBeTruthy();
    expect(actionsFor(core).zoomOut.disabled).toBeUndefined();
  });

  it("runs the same code as the keyboard", () => {
    const core = new EditorCore(docOf([rect("a", 100), rect("b", 300)]));
    core.select(["a", "b"]);
    actionsFor(core).group.run();
    expect(core.doc.root).toHaveLength(1);
    actionsFor(core).ungroup.run();
    expect(core.doc.root).toEqual(["a", "b"]);
    core.select(["a"]);
    actionsFor(core).duplicate.run();
    expect(core.doc.root).toHaveLength(3);
    actionsFor(core).delete.run();
    expect(core.doc.root).toHaveLength(2);
    actionsFor(core).selectAll.run();
    expect(core.getState().selection).toEqual(core.doc.root);
  });

  it("hands clipboard and file actions to the host", () => {
    const h = host();
    const a = actionsFor(new EditorCore(docOf([])), h);
    a.copy.run();
    a.paste.run();
    a.makeCopy.run();
    a.rename.run();
    expect(h.copy).toHaveBeenCalledOnce();
    expect(h.paste).toHaveBeenCalledOnce();
    expect(h.makeCopy).toHaveBeenCalledOnce();
    expect(h.rename).toHaveBeenCalledOnce();
  });

  it("labels the panels toggle for what it will do, and hides Fullscreen where it is unsupported", () => {
    const core = new EditorCore(docOf([]));
    expect(actionsFor(core).togglePanels.label).toBe("Hide panels");
    expect(actionsFor(core, host({ panelsHidden: true })).togglePanels.label).toBe("Show panels");
    expect(actionsFor(core, host({ canFullscreen: false })).fullscreen.hidden).toBe(true);
  });
});

describe("toMenuItems", () => {
  it("adds shortcut labels and passes the disabled reason through", () => {
    const actions = actionsFor(new EditorCore(docOf([rect("a", 100)])));
    const items = toMenuItems(actions, ["undo", "copy"], false);
    expect(items[1]).toMatchObject({ label: "Copy", shortcut: "Ctrl+C", disabled: "Select a layer first." });
    expect(toMenuItems(actions, ["copy"], true)[0]).toMatchObject({ shortcut: "⌘C" });
  });

  it("drops hidden actions without leaving stray separators", () => {
    const actions = actionsFor(new EditorCore(docOf([])), host({ canFullscreen: false }));
    expect(toMenuItems(actions, ["fit", "separator", "fullscreen"], false).map((i) => (i === "separator" ? "-" : i.label))).toEqual(["Fit to screen"]);
    expect(toMenuItems(actions, ["separator", "fit", "separator", "separator", "togglePanels"], false).map((i) => (i === "separator" ? "-" : i.label))).toEqual(["Fit to screen", "-", "Hide panels"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm --filter @vash/web exec vitest run src/components/editor/editor-actions.test.ts`
Expected: FAIL (`./editor-actions` does not exist).

- [ ] **Step 3: Implement `editor-actions.ts`**

```ts
import {
  checkPolicy,
  duplicateSelection,
  groupSelection,
  handleKey,
  planDuplicate,
  planGroup,
  planUngroup,
  ungroupSelection,
  ZOOM_MAX,
  ZOOM_MIN,
  type Command,
  type EditorCore,
  type EditorState,
  type Plan,
} from "@vash/engine";
import type { MenuItem } from "@/components/ui/menu";

export const ACTION_IDS = [
  "undo",
  "redo",
  "cut",
  "copy",
  "paste",
  "duplicate",
  "delete",
  "selectAll",
  "group",
  "ungroup",
  "newDesign",
  "open",
  "makeCopy",
  "rename",
  "moveToFolder",
  "designInfo",
  "save",
  "download",
  "zoomIn",
  "zoomOut",
  "fit",
  "fullscreen",
  "togglePanels",
  "shortcuts",
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export interface Action {
  id: ActionId;
  label: string;
  /** A spec such as "mod+shift+g", shown next to the item. The key itself is handled elsewhere. */
  shortcut?: string;
  /** Why the action cannot run right now. Absent when it can. */
  disabled?: string;
  /** Not offered at all, for example Fullscreen in a browser without it. */
  hidden?: boolean;
  run: () => void;
}

/** What the editor screen provides: the actions that need the router, dialogs, the clipboard or the browser. */
export interface ActionHost {
  panelsHidden: boolean;
  canFullscreen: boolean;
  copy(): void;
  cut(): void;
  paste(): void;
  newDesign(): void;
  open(): void;
  makeCopy(): void;
  rename(): void;
  moveToFolder(): void;
  designInfo(): void;
  save(): void;
  download(): void;
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  fullscreen(): void;
  togglePanels(): void;
  shortcuts(): void;
}

const DELETE_KEY = { key: "Delete", mod: false, shift: false, alt: false } as const;
const reasonOf = (plan: Plan): string | undefined => (plan.ok ? undefined : plan.reason);

/** Every editor action with its current enabled state. Rebuilt whenever the editor state changes. */
export function buildActions(state: EditorState, core: EditorCore, host: ActionHost): Record<ActionId, Action> {
  const { doc, selection } = state;
  const needsSelection = selection.length === 0 ? "Select a layer first." : undefined;
  const deleteRefusal = (): string | undefined => {
    if (needsSelection) return needsSelection;
    const command: Command = { type: "batch", commands: selection.map((id): Command => ({ type: "delete", id })) };
    const verdict = checkPolicy(doc, command, state.mode);
    return verdict.ok ? undefined : verdict.reason;
  };

  const list: Action[] = [
    { id: "undo", label: "Undo", shortcut: "mod+z", disabled: state.canUndo ? undefined : "Nothing to undo.", run: () => core.undo() },
    { id: "redo", label: "Redo", shortcut: "mod+shift+z", disabled: state.canRedo ? undefined : "Nothing to redo.", run: () => core.redo() },
    { id: "cut", label: "Cut", shortcut: "mod+x", disabled: deleteRefusal(), run: host.cut },
    { id: "copy", label: "Copy", shortcut: "mod+c", disabled: needsSelection, run: host.copy },
    { id: "paste", label: "Paste", shortcut: "mod+v", run: host.paste },
    { id: "duplicate", label: "Duplicate", shortcut: "mod+d", disabled: reasonOf(planDuplicate(doc, selection, state.mode)), run: () => void duplicateSelection(core) },
    { id: "delete", label: "Delete", shortcut: "delete", disabled: deleteRefusal(), run: () => void handleKey(core, DELETE_KEY) },
    { id: "selectAll", label: "Select all", shortcut: "mod+a", disabled: doc.root.length === 0 ? "Nothing to select." : undefined, run: () => core.select(core.doc.root) },
    { id: "group", label: "Group", shortcut: "mod+g", disabled: reasonOf(planGroup(doc, selection, state.mode)), run: () => void groupSelection(core) },
    { id: "ungroup", label: "Ungroup", shortcut: "mod+shift+g", disabled: reasonOf(planUngroup(doc, selection, state.mode)), run: () => void ungroupSelection(core) },
    { id: "newDesign", label: "New design", run: host.newDesign },
    { id: "open", label: "Open", run: host.open },
    { id: "makeCopy", label: "Make a copy", run: host.makeCopy },
    { id: "rename", label: "Rename", run: host.rename },
    { id: "moveToFolder", label: "Move to folder", run: host.moveToFolder },
    { id: "designInfo", label: "Design info", run: host.designInfo },
    { id: "save", label: "Save", shortcut: "mod+s", run: host.save },
    { id: "download", label: "Download", run: host.download },
    { id: "zoomIn", label: "Zoom in", disabled: state.viewport.zoom >= ZOOM_MAX - 1e-9 ? "Already at the largest zoom." : undefined, run: host.zoomIn },
    { id: "zoomOut", label: "Zoom out", disabled: state.viewport.zoom <= ZOOM_MIN + 1e-9 ? "Already at the smallest zoom." : undefined, run: host.zoomOut },
    { id: "fit", label: "Fit to screen", run: host.fit },
    { id: "fullscreen", label: "Fullscreen", hidden: !host.canFullscreen, run: host.fullscreen },
    { id: "togglePanels", label: host.panelsHidden ? "Show panels" : "Hide panels", run: host.togglePanels },
    { id: "shortcuts", label: "Keyboard shortcuts", run: host.shortcuts },
  ];
  return Object.fromEntries(list.map((a) => [a.id, a])) as Record<ActionId, Action>;
}

type Layout = readonly (ActionId | "separator")[];

export const MENUS = {
  file: ["newDesign", "open", "makeCopy", "separator", "rename", "moveToFolder", "designInfo", "separator", "save", "download"],
  edit: ["undo", "redo", "separator", "cut", "copy", "paste", "duplicate", "delete", "separator", "selectAll", "group", "ungroup"],
  view: ["zoomIn", "zoomOut", "fit", "separator", "fullscreen", "togglePanels"],
  help: ["shortcuts"],
} as const satisfies Record<string, Layout>;

export const CONTEXT_LAYOUTS = {
  node: ["cut", "copy", "paste", "duplicate", "delete", "separator", "group", "ungroup"],
  canvas: ["paste", "selectAll"],
} as const satisfies Record<string, Layout>;

const KEY_NAMES: Record<string, string> = { arrows: "Arrow keys", escape: "Esc" };

/** "mod+shift+g" as "Ctrl+Shift+G", or "⌘⇧G" on a Mac. */
export function formatShortcut(spec: string, mac: boolean): string {
  const parts = spec.split("+");
  const key = parts.pop()!;
  const label = KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key[0]!.toUpperCase() + key.slice(1));
  const modifiers: Record<string, string> = mac ? { mod: "⌘", shift: "⇧", alt: "⌥" } : { mod: "Ctrl", shift: "Shift", alt: "Alt" };
  const lead = parts.map((p) => modifiers[p] ?? p);
  return mac ? [...lead, label].join("") : [...lead, label].join("+");
}

/** Menu rows for a layout. Hidden actions are left out, and no separator is left leading, trailing or doubled. */
export function toMenuItems(actions: Record<ActionId, Action>, layout: Layout, mac: boolean): MenuItem[] {
  const items: MenuItem[] = [];
  for (const entry of layout) {
    if (entry === "separator") {
      if (items.length > 0 && items.at(-1) !== "separator") items.push("separator");
      continue;
    }
    const a = actions[entry];
    if (a.hidden) continue;
    items.push({ label: a.label, onSelect: a.run, shortcut: a.shortcut ? formatShortcut(a.shortcut, mac) : undefined, disabled: a.disabled, danger: entry === "delete" || undefined });
  }
  if (items.at(-1) === "separator") items.pop();
  return items;
}

/** Actions listed in the shortcuts dialog, in order. */
export const SHORTCUT_ACTIONS: readonly ActionId[] = ["undo", "redo", "cut", "copy", "paste", "duplicate", "delete", "selectAll", "group", "ungroup", "save"];

/** Keys and gestures the canvas handles itself, so they are not actions. */
export const OTHER_SHORTCUTS: readonly { spec: string; does: string }[] = [
  { spec: "arrows", does: "Move the selection 1 px" },
  { spec: "shift+arrows", does: "Move the selection 10 px" },
  { spec: "enter", does: "Edit the selected text" },
  { spec: "escape", does: "Deselect, or show the panels again" },
  { spec: "space", does: "Hold and drag to move around" },
  { spec: "mod+scroll", does: "Zoom in and out" },
];
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm --filter @vash/web exec vitest run src/components/editor/editor-actions.test.ts`
Expected: PASS.

Run: `corepack pnpm --filter @vash/web typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/editor-actions.ts apps/web/src/components/editor/editor-actions.test.ts
git commit -m "feat(web): editor action registry with menu layouts and shortcut labels" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Clipboard hook and toasts

**Files:**
- Create: `apps/web/src/components/editor/use-clipboard.ts`
- Modify: `apps/web/src/components/editor/editor-screen.tsx` (wrap the editor in `ToastProvider`)
- Modify: `apps/web/src/components/editor/workspace.tsx` (toast bridge, clipboard hook, remove the old notice line)

**Interfaces:**
- Consumes: engine `copySelection`, `cutSelection`, `pasteText`, `Editor`; `useToast` from `@/components/ui/toast`.
- Produces: `useClipboard(editor: Editor | null): { copy(): Promise<void>; cut(): Promise<void>; paste(): Promise<void> }`, which also listens for the browser's `copy`, `cut` and `paste` events on the document. Engine notices (`state.notice`) now show as toasts.

Untestable in node (DOM events, `navigator.clipboard`); verified in the browser in Task 16.

- [ ] **Step 1: Create `use-clipboard.ts`**

```ts
"use client";

import { copySelection, cutSelection, pasteText, type Editor } from "@vash/engine";
import { useCallback, useEffect, useRef } from "react";

/** Keys and clipboard events inside a field or a dialog belong to it, not to the canvas. */
const inField = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.closest("dialog") !== null);

/**
 * Copy, cut and paste for the canvas. The keyboard and the browser's own menu go through the clipboard
 * events; the Edit and right-click menus call the returned functions, which use the async clipboard API.
 * If that is blocked, this tab's last copy is used instead.
 */
export function useClipboard(editor: Editor | null) {
  const memory = useRef<string | null>(null);

  const write = useCallback(async (text: string) => {
    memory.current = text;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Blocked: the in-memory copy still serves pastes in this tab.
    }
  }, []);

  const copy = useCallback(async () => {
    const text = editor && copySelection(editor.core);
    if (text) await write(text);
  }, [editor, write]);

  const cut = useCallback(async () => {
    const text = editor && cutSelection(editor.core);
    if (text) await write(text);
  }, [editor, write]);

  const paste = useCallback(async () => {
    if (!editor) return;
    let text = memory.current ?? "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Blocked or denied: paste this tab's last copy.
    }
    pasteText(editor.core, text);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const onCopy = (e: ClipboardEvent) => {
      if (inField(e.target)) return;
      const text = copySelection(editor.core);
      if (!text) return;
      e.clipboardData?.setData("text/plain", text);
      memory.current = text;
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      if (inField(e.target)) return;
      const text = cutSelection(editor.core);
      if (!text) return;
      e.clipboardData?.setData("text/plain", text);
      memory.current = text;
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (inField(e.target)) return;
      e.preventDefault();
      pasteText(editor.core, e.clipboardData?.getData("text/plain") ?? "");
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, [editor]);

  return { copy, cut, paste };
}
```

- [ ] **Step 2: Wrap the editor in `ToastProvider`**

The editor route (`app/edit/[id]`) is outside `(app)/layout.tsx`, so it has no toast provider. In `apps/web/src/components/editor/editor-screen.tsx`, add the import:

```ts
import { ToastProvider } from "@/components/ui/toast";
```

and change:

```tsx
    case "ready":
      return <Workspace design={load.design} />;
```

to:

```tsx
    case "ready":
      return (
        <ToastProvider>
          <Workspace design={load.design} />
        </ToastProvider>
      );
```

- [ ] **Step 3: Show engine notices as toasts, and use the clipboard hook**

In `apps/web/src/components/editor/workspace.tsx`:

1. Add imports:

```ts
import { useToast } from "@/components/ui/toast";
import { useClipboard } from "./use-clipboard";
```

2. Inside `Workspace`, after `const state = useEditorState(editor);`, add (the hook registers the copy, cut and paste listeners itself; Task 13 keeps its return value):

```ts
  const toast = useToast();
  useClipboard(editor);
```

3. Replace this block:

```ts
  // Refusals ("Layout locked by template…") show briefly, then clear.
  const notice = state?.notice ?? null;
  useEffect(() => {
    if (!notice || !editor) return;
    const t = setTimeout(() => editor.core.setChrome({ notice: null }), 3500);
    return () => clearTimeout(t);
  }, [notice, editor]);
```

with:

```ts
  // Refusals ("Layout locked by the template.") and other engine messages show as a toast, then clear.
  const notice = state?.notice ?? null;
  useEffect(() => {
    if (!notice || !editor) return;
    toast({ message: notice, duration: 3500 });
    editor.core.setChrome({ notice: null });
  }, [notice, editor, toast]);
```

4. Delete the old notice element inside the canvas container:

```tsx
            {notice && (
              <div role="status" className="glass-primary pointer-events-none absolute top-4 left-1/2 max-w-[80%] -translate-x-1/2 rounded-xl px-4 py-2 text-[13px] text-white">
                {notice}
              </div>
            )}
```

- [ ] **Step 4: Typecheck, lint, test**

Run: `corepack pnpm --filter @vash/web typecheck`, `corepack pnpm --filter @vash/web lint`, `corepack pnpm --filter @vash/web test`
Expected: clean and green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/use-clipboard.ts apps/web/src/components/editor/editor-screen.tsx apps/web/src/components/editor/workspace.tsx
git commit -m "feat(web): copy, cut and paste on the canvas; engine messages show as toasts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Dialogs

**Files:**
- Create: `apps/web/src/components/editor/shortcuts-dialog.tsx`, `design-info-dialog.tsx`, `move-dialog.tsx`

**Interfaces:**
- Consumes: `Dialog` (`@/components/ui/dialog`), `Button`, `SelectField` (`./fields`), `formatShortcut`, `OTHER_SHORTCUTS`, `SHORTCUT_ACTIONS`, `Action`, `ActionId` (Task 9), `describeDesign` (Task 7), `listAllFolders`, `moveDesign`, `Folder` (`@/lib/api`).
- Produces:
  - `ShortcutsDialog({ open, onClose, actions, mac })`
  - `DesignInfoDialog({ open, onClose, doc, savedAt })`
  - `MoveDialog({ open, onClose, designId, folderId, onMoved })` where `onMoved(folderId: string | null, folderName: string | null): void`

Not unit-testable in node; checked in Task 16.

- [ ] **Step 1: `shortcuts-dialog.tsx`**

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { formatShortcut, OTHER_SHORTCUTS, SHORTCUT_ACTIONS, type Action, type ActionId } from "./editor-actions";

export function ShortcutsDialog({ open, onClose, actions, mac }: { open: boolean; onClose: () => void; actions: Record<ActionId, Action>; mac: boolean }) {
  const rows = [
    ...SHORTCUT_ACTIONS.flatMap((id) => (actions[id].shortcut ? [{ name: actions[id].label, keys: formatShortcut(actions[id].shortcut!, mac) }] : [])),
    ...OTHER_SHORTCUTS.map((o) => ({ name: o.does, keys: formatShortcut(o.spec, mac) })),
  ];
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <ul className="flex max-h-[50vh] flex-col overflow-y-auto text-sm">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-4 py-1.5">
            <span>{r.name}</span>
            <kbd className="rounded-md bg-field px-2 py-0.5 font-sans text-[12px] text-muted">{r.keys}</kbd>
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 2: `design-info-dialog.tsx`**

```tsx
"use client";

import type { Doc } from "@vash/schema";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { describeDesign } from "@/lib/design-info";

export function DesignInfoDialog({ open, onClose, doc, savedAt }: { open: boolean; onClose: () => void; doc: Doc; savedAt: string }) {
  return (
    <Dialog open={open} onClose={onClose} title="Design info">
      <dl className="flex flex-col gap-2.5 text-sm">
        {describeDesign(doc, savedAt).map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <dt className="text-muted">{row.label}</dt>
            <dd className="font-medium tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 3: `move-dialog.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { listAllFolders, moveDesign, type Folder } from "@/lib/api";
import { SelectField } from "./fields";

const NONE = "";

export function MoveDialog({
  open,
  onClose,
  designId,
  folderId,
  onMoved,
}: {
  open: boolean;
  onClose: () => void;
  designId: string;
  folderId: string | null;
  onMoved: (folderId: string | null, folderName: string | null) => void;
}) {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [choice, setChoice] = useState(folderId ?? NONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setChoice(folderId ?? NONE);
    setError(null);
    setFolders(null);
    listAllFolders().then(
      (all) => live && setFolders(all),
      (err: Error) => live && setError(err.message),
    );
    return () => {
      live = false;
    };
  }, [open, folderId]);

  async function move() {
    setBusy(true);
    setError(null);
    try {
      const target = choice === NONE ? null : choice;
      await moveDesign(designId, target);
      onMoved(target, folders?.find((f) => f.id === target)?.name ?? null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t move the design. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Move to folder">
      {folders && folders.length === 0 ? (
        <p className="text-sm text-muted">You have no folders yet. Create one on the Designs page.</p>
      ) : (
        <SelectField name="Folder" value={choice} disabled={folders === null || busy} onChange={setChoice}>
          <option value={NONE}>No folder</option>
          {folders?.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </SelectField>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => void move()} loading={busy} disabled={folders === null || (folders.length === 0 && folderId === null)}>
          Move
        </Button>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `corepack pnpm --filter @vash/web typecheck` and `corepack pnpm --filter @vash/web lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/editor/shortcuts-dialog.tsx apps/web/src/components/editor/design-info-dialog.tsx apps/web/src/components/editor/move-dialog.tsx
git commit -m "feat(web): shortcuts, design info and move-to-folder dialogs" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Header, inline rename and controlled Export

**Files:**
- Create: `apps/web/src/components/editor/icon-button.tsx`, `save-indicator.tsx`, `title-field.tsx`, `editor-header.tsx`
- Modify: `apps/web/src/components/editor/export-popover.tsx` (open state from props)
- Modify: `apps/web/src/components/editor/workspace.tsx`

**Interfaces:**
- Consumes: `normalizeTitle` (Task 7), the `meta` command (Task 1), `SaveStatus` (`@/lib/autosave`).
- Produces:
  - `IconButton({ label, onClick, disabled, children })` (moved unchanged)
  - `SaveIndicator({ status, onRetry, onResolve })` (moved unchanged)
  - `TitleField({ title, editing, onEditingChange, onCommit })`
  - `EditorHeader({ editor, doc, canUndo, canRedo, status, onRetry, onResolve, exportOpen, onExportOpenChange, renaming, onRenamingChange })`
  - `ExportPopover({ editor, doc, open, onOpenChange })`

- [ ] **Step 1: Move `IconButton` and `SaveIndicator` out of `workspace.tsx`**

Create `apps/web/src/components/editor/icon-button.tsx`:

```tsx
import type { ReactNode } from "react";

export function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-8 items-center justify-center rounded-lg text-text hover:bg-field disabled:opacity-35 disabled:hover:bg-transparent [&_svg]:size-[18px]"
    >
      {children}
    </button>
  );
}
```

Create `apps/web/src/components/editor/save-indicator.tsx` by moving the `STATUS` table, the `LINK` constant and the `SaveIndicator` function from `workspace.tsx` (lines 47-85) unchanged, with these imports at the top and `export` on `SaveIndicator`:

```tsx
import { CloudAlert, CloudCheck, CloudOff, CloudUpload } from "lucide-react";
import type { ReactNode } from "react";
import type { SaveStatus } from "@/lib/autosave";
import { cn } from "@/lib/utils";
```

Then delete `IconButton`, `STATUS`, `LINK` and `SaveIndicator` from `workspace.tsx`, and add `import { IconButton } from "./icon-button";` there (the footer still uses it until Task 14).

- [ ] **Step 2: Make `ExportPopover` controlled**

In `apps/web/src/components/editor/export-popover.tsx`, replace the signature and the state line:

```tsx
export function ExportPopover({ editor, doc }: { editor: Editor | null; doc: Doc }) {
  const [open, setOpen] = useState(false);
```

with:

```tsx
export function ExportPopover({ editor, doc, open, onOpenChange }: { editor: Editor | null; doc: Doc; open: boolean; onOpenChange: (open: boolean) => void }) {
```

and replace every remaining use of `setOpen`:
- `if (!root.current?.contains(e.target as Node)) setOpen(false);` becomes `onOpenChange(false);` with the same condition; the effect's dependency list `[open]` becomes `[open, onOpenChange]`.
- In the `onKeyDown` handler, `setOpen(false);` becomes `onOpenChange(false);`.
- On the trigger button, `onClick={() => setOpen((o) => !o)}` becomes `onClick={() => onOpenChange(!open)}`.

Run `grep -n "setOpen" apps/web/src/components/editor/export-popover.tsx`. Expected: no matches. Keep `useState` in the import (scale, transparent, phase, error still use it).

- [ ] **Step 3: Create `title-field.tsx`**

```tsx
"use client";

import { LIMITS } from "@vash/schema";
import { useEffect, useRef, useState } from "react";
import { normalizeTitle } from "@/lib/title";
import { cn } from "@/lib/utils";

/** The design's name in the header. Click to rename; Enter or clicking away keeps it, Escape cancels. */
export function TitleField({ title, editing, onEditingChange, onCommit }: { title: string; editing: boolean; onEditingChange: (editing: boolean) => void; onCommit: (title: string) => void }) {
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Starting to rename always begins from the current name.
  useEffect(() => {
    if (!editing) return;
    setDraft(title);
    setError(null);
    input.current?.focus();
    input.current?.select();
    // Only when editing starts: typing must not be reset by a title that changes underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (!editing) {
    return (
      <h1 className="min-w-0">
        <button type="button" onClick={() => onEditingChange(true)} title="Rename" className="max-w-[240px] truncate rounded-lg px-2 py-1 text-sm font-semibold hover:bg-field">
          {title}
        </button>
      </h1>
    );
  }

  const finish = (keepOpenOnError: boolean) => {
    const result = normalizeTitle(draft);
    if (!result.ok) {
      if (keepOpenOnError) {
        setError(result.reason);
        return;
      }
      onEditingChange(false);
      return;
    }
    if (result.title !== title) onCommit(result.title);
    onEditingChange(false);
  };

  return (
    <div className="relative min-w-0">
      <input
        ref={input}
        value={draft}
        maxLength={LIMITS.titleChars}
        aria-label="Design name"
        aria-invalid={error !== null}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={() => finish(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") {
            e.stopPropagation();
            onEditingChange(false);
          }
        }}
        className={cn("h-8 w-[240px] rounded-lg bg-field px-2 text-sm font-semibold outline-none focus-visible:shadow-[0_0_0_2px_var(--text)]", error && "shadow-[0_0_0_2px_var(--danger)]")}
      />
      {error && (
        <p role="alert" className="absolute top-full left-2 mt-1 text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
```

(`--danger` and `--text` are defined in `apps/web/src/app/globals.css` for both light and dark mode.)

- [ ] **Step 4: Create `editor-header.tsx`**

```tsx
"use client";

import type { Editor } from "@vash/engine";
import type { Doc } from "@vash/schema";
import { Redo2, Undo2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { SaveStatus } from "@/lib/autosave";
import { ExportPopover } from "./export-popover";
import { IconButton } from "./icon-button";
import { SaveIndicator } from "./save-indicator";
import { TitleField } from "./title-field";

export function EditorHeader({
  editor,
  doc,
  canUndo,
  canRedo,
  status,
  onRetry,
  onResolve,
  exportOpen,
  onExportOpenChange,
  renaming,
  onRenamingChange,
}: {
  editor: Editor | null;
  doc: Doc;
  canUndo: boolean;
  canRedo: boolean;
  status: SaveStatus;
  onRetry: () => void;
  onResolve: () => void;
  exportOpen: boolean;
  onExportOpenChange: (open: boolean) => void;
  renaming: boolean;
  onRenamingChange: (renaming: boolean) => void;
}) {
  return (
    <header className="flex h-14 flex-none items-center gap-3 border-b-[.5px] border-line px-3">
      <Link href="/designs" aria-label="Back to your designs" className="flex-none rounded-md transition-opacity hover:opacity-75">
        <Image src="/vash-logo.png" alt="" width={28} height={28} className="size-7 rounded-md" priority />
      </Link>
      <TitleField title={doc.meta.title} editing={renaming} onEditingChange={onRenamingChange} onCommit={(title) => editor?.core.dispatch({ type: "meta", patch: { title } })} />
      <SaveIndicator status={status} onRetry={onRetry} onResolve={onResolve} />
      <div className="flex-1" />
      <IconButton label="Undo (Ctrl+Z)" onClick={() => editor?.core.undo()} disabled={!canUndo}>
        <Undo2 aria-hidden />
      </IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" onClick={() => editor?.core.redo()} disabled={!canRedo}>
        <Redo2 aria-hidden />
      </IconButton>
      <ExportPopover editor={editor} doc={doc} open={exportOpen} onOpenChange={onExportOpenChange} />
    </header>
  );
}
```

- [ ] **Step 5: Use it in `workspace.tsx`**

1. Add state next to the other `useState` calls in `Workspace`:

```ts
  const [exportOpen, setExportOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
```

2. Replace the whole `<header ...>...</header>` element (logo link, `<h1>`, `SaveIndicator`, spacer, Undo, Redo, zoom `Menu`, `ExportPopover`) with:

```tsx
      <EditorHeader
        editor={editor}
        doc={state?.doc ?? design.doc}
        canUndo={state?.canUndo ?? false}
        canRedo={state?.canRedo ?? false}
        status={status}
        onRetry={() => void saver.current?.flush()}
        onResolve={() => setConflictOpen(true)}
        exportOpen={exportOpen}
        onExportOpenChange={setExportOpen}
        renaming={renaming}
        onRenamingChange={setRenaming}
      />
```

The header zoom menu is removed on purpose (the bottom bar keeps zoom; spec 3.3).

3. Fix imports: add `import { EditorHeader } from "./editor-header";`; remove `ExportPopover`, `Menu`, `Image`, `Link`, `cn`, and the lucide names no longer used (`ChevronDown`, `CloudAlert`, `CloudCheck`, `CloudOff`, `CloudUpload`, `Redo2`, `Undo2`; keep `ZoomIn`, `ZoomOut` until Task 14), and `ReactNode` if unused. Let `typecheck` and `lint` tell you which imports are left over.

- [ ] **Step 6: Typecheck, lint, test**

Run: `corepack pnpm --filter @vash/web typecheck`, `corepack pnpm --filter @vash/web lint`, `corepack pnpm --filter @vash/web test`
Expected: clean and green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/editor
git commit -m "feat(web): rename the design from the header; export open state is controlled" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Menu bar, Save, Make a copy, Fullscreen, Hide panels

**Files:**
- Create: `apps/web/src/components/editor/menu-bar.tsx`, `use-fullscreen.ts`
- Modify: `apps/web/src/components/editor/editor-header.tsx` (add the menu bar)
- Modify: `apps/web/src/components/editor/workspace.tsx`

**Interfaces:**
- Consumes: `buildActions`, `MENUS`, `toMenuItems`, `ActionHost`, `Action`, `ActionId` (Task 9); `useClipboard` (Task 10); dialogs (Task 11); `duplicateDesign` (`@/lib/api`).
- Produces: `MenuBar({ actions, mac })`, `useFullscreen(ref: RefObject<HTMLElement | null>): { supported: boolean; active: boolean; toggle: () => Promise<void> }`.

- [ ] **Step 1: `use-fullscreen.ts`**

```ts
"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

/** Fullscreen for one element, with whether the browser allows it and whether it is on now. */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  const supported = typeof document !== "undefined" && document.fullscreenEnabled;

  useEffect(() => {
    const on = () => setActive(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const toggle = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await ref.current?.requestFullscreen();
  }, [ref]);

  return { supported, active, toggle };
}
```

- [ ] **Step 2: `menu-bar.tsx`**

```tsx
"use client";

import { Menu } from "@/components/ui/menu";
import { MENUS, toMenuItems, type Action, type ActionId } from "./editor-actions";

const TITLES = { file: "File", edit: "Edit", view: "View", help: "Help" } as const;

export function MenuBar({ actions, mac }: { actions: Record<ActionId, Action>; mac: boolean }) {
  return (
    <nav aria-label="Editor menus" className="flex items-center">
      {(Object.keys(TITLES) as (keyof typeof TITLES)[]).map((key) => (
        <Menu
          key={key}
          align="start"
          items={toMenuItems(actions, MENUS[key], mac)}
          trigger={(props) => (
            <button type="button" {...props} className="h-8 rounded-lg px-2.5 text-[13px] font-medium hover:bg-field aria-expanded:bg-field">
              {TITLES[key]}
            </button>
          )}
        />
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Add the menu bar to the header**

In `editor-header.tsx`: add `import { MenuBar } from "./menu-bar";` and `import type { Action, ActionId } from "./editor-actions";`, add two props to the props type and the destructuring:

```ts
  actions: Record<ActionId, Action> | null;
  mac: boolean;
```

and render, between the logo `Link` and `TitleField`:

```tsx
      {actions && <MenuBar actions={actions} mac={mac} />}
```

- [ ] **Step 4: Wire the host into `workspace.tsx`**

1. Imports to add:

```ts
import { duplicateDesign } from "@/lib/api";          // add to the existing "@/lib/api" import
import { useMemo } from "react";                        // add to the existing "react" import
import { buildActions, type ActionHost } from "./editor-actions";
import { DesignInfoDialog } from "./design-info-dialog";
import { MoveDialog } from "./move-dialog";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { useFullscreen } from "./use-fullscreen";
```

2. State and hooks in `Workspace` (replace the `useClipboard(editor);` line from Task 10 with the first line below):

```ts
  const clipboard = useClipboard(editor);
  const root = useRef<HTMLElement>(null);
  const fullscreen = useFullscreen(root);
  const [infoOpen, setInfoOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [savedAt, setSavedAt] = useState(design.updatedAt);
  const [folderId, setFolderId] = useState(design.folderId);
  const mac = useMemo(() => typeof navigator !== "undefined" && navigator.platform.startsWith("Mac"), []);
```

3. Effects and functions, after the existing conflict effects:

```ts
  // When a save finishes, "Last saved" in Design info moves on.
  const wasSaved = useRef(true);
  useEffect(() => {
    if (status === "saved" && !wasSaved.current) setSavedAt(new Date().toISOString());
    wasSaved.current = status === "saved";
  }, [status]);

  /** Saves now. `flush` never throws; a leftover `dirty` means the save did not go through. */
  async function saveNow() {
    const s = saver.current;
    if (!s) return;
    await s.flush();
    toast({ message: s.dirty ? "Not saved yet. The status at the top shows why." : "All changes saved.", duration: 3000 });
  }

  async function makeCopy() {
    const s = saver.current;
    try {
      if (s?.dirty) await s.flush();
      if (s?.dirty) {
        toast({ message: "Your latest changes are still saving. Try again in a moment." });
        return;
      }
      const copy = await duplicateDesign(design.id);
      router.push(`/edit/${copy.id}`);
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn’t make a copy. Try again." });
    }
  }

  // Ctrl+S saves and keeps the browser's Save dialog away.
  const save = useRef(saveNow);
  save.current = saveNow;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((mac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mac]);

  // Escape brings hidden panels back.
  useEffect(() => {
    if (!panelsHidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelsHidden(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelsHidden]);

  // The canvas area changes size when panels hide or fullscreen starts: fit once the layout has settled.
  useEffect(() => {
    if (!editor) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => editor.fit()));
    return () => cancelAnimationFrame(frame);
  }, [editor, panelsHidden, fullscreen.active]);

  const host: ActionHost = {
    panelsHidden,
    canFullscreen: fullscreen.supported,
    copy: () => void clipboard.copy(),
    cut: () => void clipboard.cut(),
    paste: () => void clipboard.paste(),
    newDesign: () => router.push("/home#create"),
    open: () => router.push("/designs"),
    makeCopy: () => void makeCopy(),
    rename: () => setRenaming(true),
    moveToFolder: () => setMoveOpen(true),
    designInfo: () => setInfoOpen(true),
    save: () => void saveNow(),
    download: () => setExportOpen(true),
    zoomIn: () => editor?.zoomTo(editor.getState().viewport.zoom * 1.25),
    zoomOut: () => editor?.zoomTo(editor.getState().viewport.zoom / 1.25),
    fit: () => editor?.fit(),
    fullscreen: () => void fullscreen.toggle().catch(() => toast({ message: "Fullscreen isn’t available right now." })),
    togglePanels: () => setPanelsHidden((hidden) => !hidden),
    shortcuts: () => setShortcutsOpen(true),
  };
  const actions = state && editor ? buildActions(state, editor.core, host) : null;
```

4. In the JSX:
   - Put `ref={root}` on the root `<main ...>`.
   - Pass `actions={actions}` and `mac={mac}` to `<EditorHeader />`.
   - Hide the panels: wrap the `<InsertRail editor={editor} />` as `{!panelsHidden && <InsertRail editor={editor} />}`, the `<footer>` as `{!panelsHidden && (<footer>...</footer>)}`, and the `<aside>` as `{!panelsHidden && (<aside>...</aside>)}`.
   - Inside the canvas container `div` (the one with `ref={container}`), after `TextEditor`, add:

```tsx
            {panelsHidden && (
              <button type="button" onClick={() => setPanelsHidden(false)} className="glass-btn glass-secondary absolute top-3 right-3 h-8 rounded-lg px-3 text-[13px]">
                <span className="glass-label">Show panels</span>
              </button>
            )}
```

   - After the conflict `Dialog`, before `</main>`, add:

```tsx
      {actions && <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} actions={actions} mac={mac} />}
      <DesignInfoDialog open={infoOpen} onClose={() => setInfoOpen(false)} doc={state?.doc ?? design.doc} savedAt={savedAt} />
      <MoveDialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        designId={design.id}
        folderId={folderId}
        onMoved={(id, name) => {
          setFolderId(id);
          toast({ message: name ? `Moved to ${name}.` : "Removed from its folder." });
        }}
      />
```

- [ ] **Step 5: Typecheck, lint, test**

Run: `corepack pnpm --filter @vash/web typecheck`, `corepack pnpm --filter @vash/web lint`, `corepack pnpm --filter @vash/web test`
Expected: clean and green. If lint flags writing `save.current = saveNow` during render, follow the same pattern as `Slider` in `fields.tsx` (`latest.current = onChange`), which the repo already accepts.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/editor
git commit -m "feat(web): File, Edit, View and Help menus; Save, Make a copy, Fullscreen and Hide panels" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Bottom bar with a zoom slider

**Files:**
- Create: `apps/web/src/components/editor/bottom-bar.tsx`
- Modify: `apps/web/src/components/editor/workspace.tsx` (replace the footer)

**Interfaces:**
- Consumes: `sliderToZoom`, `zoomToSlider`, `SLIDER_STEPS` (Task 7); `Action`, `ActionId` (Task 9); `IconButton` (Task 12).
- Produces: `BottomBar({ editor, zoom, size, actions })` where `size` is `{ width: number; height: number }`.

- [ ] **Step 1: Create `bottom-bar.tsx`**

```tsx
"use client";

import type { Editor } from "@vash/engine";
import { CircleHelp, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { SLIDER_STEPS, sliderToZoom, zoomToSlider } from "@/lib/zoom-slider";
import type { Action, ActionId } from "./editor-actions";
import { IconButton } from "./icon-button";

export function BottomBar({ editor, zoom, size, actions }: { editor: Editor | null; zoom: number; size: { width: number; height: number }; actions: Record<ActionId, Action> | null }) {
  return (
    <footer className="flex h-10 flex-none items-center gap-1 border-t-[.5px] border-line px-3 text-[13px] text-muted">
      <IconButton label="Zoom out" onClick={() => actions?.zoomOut.run()} disabled={!actions || !!actions.zoomOut.disabled}>
        <ZoomOut aria-hidden />
      </IconButton>
      <input
        type="range"
        aria-label="Zoom"
        min={0}
        max={SLIDER_STEPS}
        value={zoomToSlider(zoom)}
        onChange={(e) => editor?.zoomTo(sliderToZoom(Number(e.target.value)))}
        className="h-4 w-32 cursor-pointer accent-(--text)"
      />
      <IconButton label="Zoom in" onClick={() => actions?.zoomIn.run()} disabled={!actions || !!actions.zoomIn.disabled}>
        <ZoomIn aria-hidden />
      </IconButton>
      <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={() => actions?.fit.run()} className="h-7 rounded-md px-2 font-medium text-text hover:bg-field">
        Fit
      </button>
      <div className="flex-1" />
      <span className="tabular-nums">
        {size.width} × {size.height}
      </span>
      {actions && !actions.fullscreen.hidden && (
        <IconButton label="Fullscreen" onClick={() => actions.fullscreen.run()}>
          <Maximize aria-hidden />
        </IconButton>
      )}
      <IconButton label="Keyboard shortcuts" onClick={() => actions?.shortcuts.run()} disabled={!actions}>
        <CircleHelp aria-hidden />
      </IconButton>
    </footer>
  );
}
```

- [ ] **Step 2: Use it in `workspace.tsx`**

Replace the whole `{!panelsHidden && (<footer>...</footer>)}` block (from Task 13) with:

```tsx
          {!panelsHidden && <BottomBar editor={editor} zoom={zoom} size={artboard} actions={actions} />}
```

Add `import { BottomBar } from "./bottom-bar";`, and remove the now-unused `ZoomIn`, `ZoomOut` imports and the `IconButton` import from `workspace.tsx` if lint flags them. `artboard` is `{ width, height, background }`, which satisfies `size`.

- [ ] **Step 3: Typecheck, lint, test**

Run: `corepack pnpm --filter @vash/web typecheck`, `corepack pnpm --filter @vash/web lint`, `corepack pnpm --filter @vash/web test`
Expected: clean and green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor
git commit -m "feat(web): bottom bar with zoom slider, fullscreen and help" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Right-click menu

**Files:**
- Create: `apps/web/src/components/editor/context-menu.tsx`
- Modify: `apps/web/src/components/editor/workspace.tsx`

**Interfaces:**
- Consumes: `MENU_PANEL`, `MenuItems`, `moveMenuFocus`, `MenuItem` (Task 8); `clampMenuPosition` (Task 7); `CONTEXT_LAYOUTS`, `toMenuItems` (Task 9); engine `hitTest`, `toWorld`, `topLevelOf`.
- Produces: `ContextMenu({ at, items, onClose })` where `at: { x: number; y: number } | null` in viewport pixels.

The engine ignores non-primary buttons (`interaction.ts:179`), so a right-click does not select anything; the handler must select the layer under the pointer itself.

- [ ] **Step 1: Create `context-menu.tsx`**

```tsx
"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { MENU_PANEL, MenuItems, moveMenuFocus, type MenuItem } from "@/components/ui/menu";
import { clampMenuPosition } from "@/lib/menu-position";

/** A menu at the pointer (viewport pixels). Escape, an outside click, scrolling or resizing closes it. */
export function ContextMenu({ at, items, onClose }: { at: { x: number; y: number } | null; items: MenuItem[]; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);

  // Opened where the pointer is, then nudged back on screen once its size is known.
  useLayoutEffect(() => {
    const el = list.current;
    if (!at || !el) return;
    const r = el.getBoundingClientRect();
    const p = clampMenuPosition(at, { width: r.width, height: r.height }, { width: window.innerWidth, height: window.innerHeight });
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const away = (e: PointerEvent) => {
      if (!list.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", away);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [at, onClose]);

  if (!at) return null;
  return (
    <div
      ref={list}
      role="menu"
      aria-label="Layer actions"
      className={`fixed z-50 ${MENU_PANEL}`}
      style={{ left: at.x, top: at.y }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        else moveMenuFocus(e, list.current);
      }}
    >
      <MenuItems items={items} onDone={onClose} />
    </div>
  );
}
```

- [ ] **Step 2: Open it from the canvas in `workspace.tsx`**

1. Imports:

```ts
import { hitTest, toWorld, topLevelOf } from "@vash/engine";      // add to the existing "@vash/engine" import
import { ContextMenu } from "./context-menu";
import { CONTEXT_LAYOUTS, toMenuItems } from "./editor-actions";   // add to the existing "./editor-actions" import
```

2. State and effect in `Workspace`:

```ts
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; onLayer: boolean } | null>(null);

  // Right-click selects the layer under the pointer (unless it is already selected) and opens the menu.
  useEffect(() => {
    const el = overlay.current;
    if (!el || !editor) return;
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      editor.core.endTextEdit(true);
      const rect = el.getBoundingClientRect();
      const s = editor.getState();
      const hit = hitTest(s.doc, toWorld(s.viewport, { x: e.clientX - rect.left, y: e.clientY - rect.top }));
      if (hit) {
        const top = topLevelOf(s.doc, hit);
        if (!s.selection.includes(hit) && !s.selection.includes(top)) editor.core.select([top]);
      } else {
        editor.core.select([]);
      }
      setMenuAt({ x: e.clientX, y: e.clientY, onLayer: hit !== null });
    };
    el.addEventListener("contextmenu", onContext);
    return () => el.removeEventListener("contextmenu", onContext);
  }, [editor]);
```

3. Render, next to the dialogs at the end of `<main>`:

```tsx
      {actions && (
        <ContextMenu
          at={menuAt}
          items={toMenuItems(actions, menuAt?.onLayer ? CONTEXT_LAYOUTS.node : CONTEXT_LAYOUTS.canvas, mac)}
          onClose={() => setMenuAt(null)}
        />
      )}
```

`onClose` is a new function each render, which re-subscribes the outside-click listener each render; that is harmless. If lint complains, wrap it in `useCallback` with an empty dependency list.

- [ ] **Step 3: Typecheck, lint, test**

Run: `corepack pnpm --filter @vash/web typecheck`, `corepack pnpm --filter @vash/web lint`, `corepack pnpm --filter @vash/web test`
Expected: clean and green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/editor
git commit -m "feat(web): right-click menu on the canvas" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Verify in the browser, update the spec, prepare the PR

**Files:**
- Modify: `docs/superpowers/specs/2026-09-29-editor-shell-design.md` (record the decisions from the top of this plan)

- [ ] **Step 1: Run the whole suite**

Run: `corepack pnpm -r test`, then `corepack pnpm typecheck`, then `corepack pnpm lint`
Expected: all green. Fix anything red before continuing; do not skip a failing check.

- [ ] **Step 2: Start the app**

Follow `AGENTS.md` "Commands": start the in-memory database (`npx -y -p @electric-sql/pglite-socket@0.2.11 -p @electric-sql/pglite pglite-server --db=memory:// --port=5433 --max-connections=10`), set `DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres` in `apps/web/.env.local` (never print or commit it), run `corepack pnpm db:migrate`, then `corepack pnpm --filter @vash/web dev`. Sign in with a magic link (it is printed in the server log when no mail keys are set). Create a design from a template and open the editor at 1280 px wide.

- [ ] **Step 3: Check every control, in light mode and then in dark mode**

Use the built-in browser (`preview_start`), `read_page` for state, and `editor.exportPng()` or DOM state for the canvas (the canvas only draws while the tab is visible). Tick each item:

- [ ] Header: logo goes to Your designs; File, Edit, View, Help open, close on Escape and on an outside click, and arrow keys move between items.
- [ ] Rename: click the title, type a new name, press Enter; it shows in the header and after a reload. Empty name and 121 characters are refused with a message; Escape cancels; Ctrl+Z reverts the rename. File > Rename does the same.
- [ ] Save: Ctrl+S shows "All changes saved." and no browser Save dialog opens. The save indicator still works when offline (DevTools > Offline shows "Offline, retrying").
- [ ] Edit menu, with one layer selected: Copy, Paste (a new layer offset to the lower right), Cut, Duplicate, Delete, Select all all work and match Ctrl+C, V, X, D, Delete, A. With two layers: Group creates a group and the layers do not move; Ungroup restores them. Undo and Redo step through each.
- [ ] Locked layers (open a template with locked layers): Cut, Delete and Group show as disabled with a reason on hover, and Ctrl+X / Delete / Ctrl+G give a toast with the reason. After a refused Ctrl+X, pasting does not paste the locked layer.
- [ ] Paste hostile text: copy "hello" elsewhere, press Ctrl+V on the canvas: toast "Nothing to paste." and nothing changes.
- [ ] Typing safety: click into the rename box and press Ctrl+D, Ctrl+G, Delete: nothing happens on the canvas. Open Design info and press Delete and Ctrl+D: nothing happens on the canvas behind it.
- [ ] Right-click a layer: it gets selected and the menu shows Cut, Copy, Paste, Duplicate, Delete, Group, Ungroup with correct disabled states. Right-click empty canvas: Paste and Select all. The menu stays on screen near the edges, closes on Escape, an outside click and resize.
- [ ] View menu and bottom bar: Zoom in/out, the slider (drag it), Fit and the percentage agree; Zoom in is disabled at 800%. Fullscreen enters and leaves. Hide panels hides the rail, the right panel and the bottom bar, the design refits, "Show panels" and Escape bring them back.
- [ ] File menu: New design goes to the create section; Open goes to Your designs; Make a copy opens "Copy of ..." (including edits made a second before); Move to folder lists real folders, moves, and shows a toast; Design info shows real size, format, layer count and time; Download opens Export and a PNG downloads.
- [ ] Help: Keyboard shortcuts lists the shortcuts, with Ctrl on Windows.
- [ ] Layout at exactly 1024 px wide: the header does not wrap or overlap. At phone width the existing "needs a bigger screen" notice still shows.
- [ ] Console and network: no errors or failed requests (`read_console_messages`, `read_network_requests`).
- [ ] Copy check: no em dashes, no emoji, no pill buttons in anything added.

Take a screenshot of the editor with the File menu open, and one in dark mode, as proof for the PR.

- [ ] **Step 4: Record the decisions in the spec**

In `docs/superpowers/specs/2026-09-29-editor-shell-design.md`:
- Section 3.2, first bullet: replace "New commands `group` and `ungroup`, each one undo step." with "Group and ungroup are plan builders that emit the existing `insert` and `delete` commands as one batch (one undo step), so the lock policy applies unchanged. The only new command is `meta`, used by rename."
- Section 3.3, Rename bullet: replace the sentence about `renameDesign` and the title check with "Rename dispatches the `meta` command and autosave stores it, because `PUT` sets the stored title from `doc.meta.title` and would undo a separate `PATCH`. Ctrl+Z can undo a rename."
- Section 3.2: add "Every plan is validated with `validateDoc` before it is applied. Duplicated and pasted layers get `lock: free` in a design. Ungroup is refused when a stretched group would need shear."
- Section 3.3, Clipboard bullet: add "Photos and stickers the design does not already use are left out of a paste and the user is told."

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-29-editor-shell-design.md
git commit -m "docs(spec): record editor shell decisions made during planning" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Hand off**

Do not open the PR yourself without the owner's go-ahead. Report: what was built, the results of `pnpm -r test`, `typecheck` and `lint`, the screenshots, any item in the Step 3 checklist that failed, and that `feat/motion-photos` is many commits ahead of `main` (the PR base needs the owner's decision).

---

## Self-review

**Spec coverage** (spec section, then the task that implements it)

- 3.1 approach (one registry): Task 9, used by Tasks 11 to 15.
- 3.2 engine: group/ungroup Task 4; duplicate Task 3; clipboard payload and paste validation Tasks 5 and 6 (`validateDoc` in `runPlan`); asset-id rule Task 5; lock policy through `checkPolicy` (Tasks 4, 6); shortcuts Task 6. The spec's "new `group` and `ungroup` commands" is deliberately implemented as plans, recorded at the top and written back to the spec in Task 16.
- 3.3 web files: `editor-actions.ts` Task 9; `title-field.tsx` Task 12; `menu-bar.tsx` Task 13; `context-menu.tsx` Task 15; `shortcuts-dialog.tsx` and `design-info-dialog.tsx` Task 11; `use-clipboard.ts` Task 10. The spec's file table lists no `move-dialog.tsx`, but File > Move to folder needs one (Task 11).
- 3.3 behaviour: clipboard (Task 10), rename (Tasks 1, 7, 12), Ctrl+S (Task 13), toasts (Task 10), fullscreen and Hide panels (Task 13), zoom slider and removal of the header zoom menu (Tasks 12, 14), save status kept as is, Design info only (Task 11).
- 3.3 menus: File (New design, Open, Make a copy, Rename, Move to folder, Design info, Download; plus Save), Edit, View, Help, right-click menu: Tasks 9, 13, 15. Save appears in File because Ctrl+S needed a visible entry.
- 3.4 edge cases: "Nothing to paste." (Tasks 5, 6); locked disabled with reason (Tasks 4, 9); clipboard blocked falls back (Task 10); rename failure: there is no network step now, so the spec's "reverts on failure" cannot occur and save failures show in the save indicator (recorded in Task 16); Make a copy failure toast (Task 13); Fullscreen unsupported hides the item (Tasks 9, 13); focus in a field or dialog disables design shortcuts (Tasks 6, 10, manual check in Task 16).
- 3.5 testing: engine tests Tasks 1 to 6, web pure tests Tasks 7 and 9, browser check Task 16.
- 3.6: no new data, service or dependency; validated on paste (Task 6) and on save (existing).
- 3.7 out of scope: nothing added for version history, notifications, collaborators, Present, Publish.

**Placeholder scan:** no "TBD" or "similar to Task N". Two instructions ask the implementer to adapt to what the linter or typechecker reports (`--danger` token name in Task 12, the render-time ref write in Task 13); both name the exact alternative.

**Type consistency:** `Plan` and `refuse` (Task 3) are used unchanged in Tasks 4 to 6 and 9. `planDuplicate`, `planGroup`, `planUngroup` take `(doc, ids, mode)` everywhere. `runPlan`, `duplicateSelection`, `groupSelection`, `ungroupSelection`, `copySelection`, `cutSelection`, `pasteText` are exported in Task 6 and consumed with the same names in Tasks 9 and 10. `ActionHost` members match `host` in Task 13 and the test fake in Task 9. `ContextMenu` props match the Task 15 call. `MenuItem.disabled` is a string reason in Tasks 8, 9 and 15. `ExportPopover` props match the Task 12 header call.

**Review Focus coverage:** items 1 and 3 in Tasks 5 and 6; item 2 in Tasks 2 and 4; item 4 in Tasks 4, 6 and 9; item 5 in Tasks 1 and 7 (autosave survival is by construction: the title lives in the document; confirmed by the reload check in Task 16).
