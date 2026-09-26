# P1 · M1 — Editor engine core + first editor page

**Spec:** `docs/superpowers/specs/2026-09-24-vash-design.md` §5 (engine ↔ React boundary), §6 (format), §7 (engine modules), §11 (budgets, tests).
**Branch:** `feat/engine-core`. Each task ends green (`pnpm -r typecheck`, `eslint .`, `pnpm -r test`) and is committed.

## Conventions fixed here
- `transform.x/y` is the node **centre** in its parent's space (seed templates already do this).
  Local matrix = T(x, y) · R(rotation) · S(scaleX, scaleY); the node's box spans ±width/2, ±height/2 around its centre.
- Group children are positioned relative to the group's centre: world = parent world × child local.
- `packages/engine` is pure TypeScript with zero runtime dependencies (DOM types only), no React.
- Everything testable without a browser: rendering takes a `CanvasRenderingContext2D`-shaped target,
  text measurement is injected, time and IDs are injected.

## Tasks
1. [ ] **Scaffold** `packages/engine` (package.json, tsconfig, vitest); `apps/web` depends on it.
2. [ ] **math** — `Mat` (affine 2×3): identity, multiply, invert, apply, fromTransform; rect corners → AABB; tests.
3. [ ] **scene** — draw order (bottom → top, groups flattened), world matrices with a per-doc cache, parent lookup; tests.
4. [ ] **commands + history** — commands return `{ doc, inverse }`; `update-node`, `reorder`, `delete`, `insert`; transactions
      (begin/update/commit) coalesce a drag into one undo step; 200-step undo/redo; structural sharing; tests.
5. [ ] **policy** — in `design` mode reject commands that move/resize `content-only` or touch `locked` layers; tests.
6. [ ] **hit-test** — topmost visible node under a world point via inverse world matrix; rect/ellipse exact, others by box; tests.
7. [ ] **snapping** — artboard + other nodes' edges/centres, 6 screen-px threshold, guide lines out; tests.
8. [ ] **text layout** — injected measurer; greedy wrap, long-word break, align, line height, letter spacing,
      shrink-to-fit by binary search on size; cache; tests with a fake measurer.
9. [ ] **render** — Canvas2D: background fill, shapes (rect radius, ellipse, polygon, path via `Path2D`), frames
      (clip + placeholder hatch / "Drop a photo"), text, sticker placeholder; overlay: selection box, 8 handles,
      rotation handle, snapping guides (#FF3EA5) with 1 px halo; DPR + zoom/pan viewport; dirty-flag rAF loop.
10. [ ] **interaction** — pointer state machine: select, shift-toggle, move, resize (Shift keeps ratio, Alt from centre),
       rotate (Shift snaps 15°), pan with Space/middle button, wheel zoom; one transaction per drag; tests via synthetic events.
11. [ ] **editor facade** — `createEditor({ canvas, overlay, doc, measure, now })` → `{ getState, subscribe, dispatch,
       undo, redo, setZoom, destroy }` for `useSyncExternalStore`.
12. [ ] **`/edit/[id]` page** — load via `GET /api/designs/:id`; canvas + top bar (title, saved status, undo/redo, zoom)
       + layers list; autosave `PUT` debounced 1.5 s with `version`, 409 → conflict notice; < 1024 px → "needs a bigger screen".
13. [ ] **Benchmark page** — 150 layers, measure frame time while dragging (M1 exit: ≤ 16 ms).

Out of this plan (M2): WebGL filters, photo decoding and placement, export, full panels (text/shapes/stickers/filters), Author Mode.
