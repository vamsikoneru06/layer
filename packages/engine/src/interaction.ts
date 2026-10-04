import type { NodeId, Transform } from "@vash/schema";
import type { Command } from "./commands";
import type { EditorCore } from "./editor-core";
import { handleAt, HANDLE_DIRECTIONS, selectionFrame, type Handle, type ResizeHandle } from "./handles";
import { hitTest, nodesInBox } from "./hit-test";
import { aabb, apply, boxCorners, invert, rotation as rotationMat, type Box, type Mat, type Point } from "./math";
import { parentOf, topLevelOf, worldMatrix } from "./scene";
import { createSnapper, type Guide, type Snapper } from "./snapping";
import { toWorld, zoomAt } from "./viewport";

/** A pointer event in CSS px relative to the canvas. `button`: 0 primary, 1 middle. */
export interface PointerInput {
  x: number;
  y: number;
  button: number;
  shift: boolean;
  alt: boolean;
}

export interface WheelInput {
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
  /** Ctrl/⌘ held or a trackpad pinch: zoom instead of pan. */
  zoom: boolean;
}

export interface Interaction {
  pointerDown(e: PointerInput): void;
  pointerMove(e: PointerInput): void;
  pointerUp(e: PointerInput): void;
  wheel(e: WheelInput): void;
  /** Space held: primary drags pan the canvas. */
  setSpace(held: boolean): void;
  cancel(): void;
  /** CSS cursor for the current pointer position / drag. */
  cursor(): string;
}

/** Screen px a press must travel before it becomes a move. */
const DRAG_THRESHOLD = 3;
const SNAP_PX = 6;
const MIN_SIZE = 1;

interface Start {
  transform: Transform;
  width: number;
  height: number;
  world: Mat;
  /** Parent world → local linear inverse, for converting world deltas into the node's parent space. */
  parentInverse: Mat;
}

type Drag =
  | { kind: "press"; at: Point; ids: NodeId[] }
  | { kind: "move"; at: Point; ids: NodeId[]; starts: Map<NodeId, Start>; box: Box; snapper: Snapper }
  | { kind: "resize"; handle: ResizeHandle; id: NodeId; start: Start; snapper: Snapper | null }
  | { kind: "rotate"; id: NodeId; start: Start; centre: Point; fromAngle: number }
  | { kind: "marquee"; from: Point; base: NodeId[] }
  | { kind: "pan"; last: Point };

const CURSORS: Record<ResizeHandle, string> = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };

export function createInteraction(core: EditorCore): Interaction {
  let drag: Drag | null = null;
  let space = false;
  let hoverHandle: Handle | null = null;

  const view = () => core.getState().viewport;
  const world = (e: PointerInput) => toWorld(view(), e);

  function startOf(id: NodeId): Start {
    const doc = core.doc;
    const node = doc.nodes[id]!;
    const parent = parentOf(doc, id);
    const pw = parent ? worldMatrix(doc, parent) : ([1, 0, 0, 1, 0, 0] as const);
    const linear = invert([pw[0], pw[1], pw[2], pw[3], 0, 0]) ?? ([1, 0, 0, 1, 0, 0] as const);
    return { transform: node.transform, width: node.width, height: node.height, world: worldMatrix(doc, id), parentInverse: linear };
  }

  function singleHandle(e: PointerInput): Handle | null {
    const s = core.getState();
    if (s.selection.length !== 1) return null;
    const frame = selectionFrame(s.doc, s.selection);
    return frame ? handleAt(frame, s.viewport, e, { layoutLocked: s.layoutLocked }) : null;
  }

  function beginMove(d: Extract<Drag, { kind: "press" }>): Drag {
    const doc = core.doc;
    const starts = new Map(d.ids.map((id) => [id, startOf(id)]));
    const corners = d.ids.flatMap((id) => boxCorners(doc.nodes[id]!.width, doc.nodes[id]!.height, worldMatrix(doc, id)));
    core.beginTransaction();
    core.setChrome({ dragging: true, hover: null });
    return { kind: "move", at: d.at, ids: d.ids, starts, box: aabb(corners), snapper: createSnapper(doc, new Set(d.ids)) };
  }

  function moveTo(d: Extract<Drag, { kind: "move" }>, e: PointerInput): void {
    const p = world(e);
    let dx = p.x - d.at.x;
    let dy = p.y - d.at.y;
    const snap = d.snapper.snapBox({ minX: d.box.minX + dx, minY: d.box.minY + dy, maxX: d.box.maxX + dx, maxY: d.box.maxY + dy }, SNAP_PX / view().zoom);
    dx += snap.dx;
    dy += snap.dy;
    const commands: Command[] = [];
    for (const [id, s] of d.starts) {
      const local = apply(s.parentInverse, { x: dx, y: dy });
      commands.push({ type: "update", id, patch: { transform: { ...s.transform, x: s.transform.x + local.x, y: s.transform.y + local.y } } });
    }
    if (!core.preview({ type: "batch", commands })) return finish(false);
    core.setChrome({ guides: snap.guides });
  }

  function resizeTo(d: Extract<Drag, { kind: "resize" }>, e: PointerInput): void {
    const { start: s, handle } = d;
    const dir = HANDLE_DIRECTIONS[handle];
    let pointer = world(e);
    let guides: Guide[] = [];
    if (d.snapper) {
      // Axis-aligned layers snap the dragged edge(s).
      const threshold = SNAP_PX / view().zoom;
      const sx = dir.x !== 0 ? d.snapper.snapValue("x", pointer.x, threshold) : null;
      const sy = dir.y !== 0 ? d.snapper.snapValue("y", pointer.y, threshold) : null;
      pointer = { x: sx?.value ?? pointer.x, y: sy?.value ?? pointer.y };
      guides = [sx?.guide, sy?.guide].filter((g): g is Guide => Boolean(g));
    }
    const inv = invert(s.world);
    if (!inv) return;
    const p = apply(inv, pointer);
    const anchor = e.alt ? { x: 0, y: 0 } : { x: (-dir.x * s.width) / 2, y: (-dir.y * s.height) / 2 };
    const span = (axis: "x" | "y", size: number) => {
      const d0 = dir[axis];
      if (d0 === 0) return size;
      const raw = e.alt ? 2 * p[axis] * d0 : (p[axis] - anchor[axis]) * d0;
      return Math.max(MIN_SIZE, raw);
    };
    let width = span("x", s.width);
    let height = span("y", s.height);
    if (e.shift && dir.x !== 0 && dir.y !== 0) {
      const f = Math.max(width / s.width, height / s.height);
      width = Math.max(MIN_SIZE, s.width * f);
      height = Math.max(MIN_SIZE, s.height * f);
    }
    // New centre in the node's unscaled local space, then into the parent's space.
    const centre = e.alt ? { x: 0, y: 0 } : { x: dir.x === 0 ? 0 : anchor.x + (dir.x * width) / 2, y: dir.y === 0 ? 0 : anchor.y + (dir.y * height) / 2 };
    const t = s.transform;
    const rs = rotationMat(t.rotation);
    const offset = apply(rs, { x: centre.x * t.scaleX, y: centre.y * t.scaleY });
    const ok = core.preview({ type: "update", id: d.id, patch: { width, height, transform: { ...t, x: t.x + offset.x, y: t.y + offset.y } } });
    if (!ok) return finish(false);
    core.setChrome({ guides });
  }

  function rotateTo(d: Extract<Drag, { kind: "rotate" }>, e: PointerInput): void {
    const p = world(e);
    const angle = (Math.atan2(p.y - d.centre.y, p.x - d.centre.x) * 180) / Math.PI;
    let next = d.start.transform.rotation + angle - d.fromAngle;
    if (e.shift) next = Math.round(next / 15) * 15;
    next = ((((next + 180) % 360) + 360) % 360) - 180;
    if (!core.preview({ type: "update", id: d.id, patch: { transform: { ...d.start.transform, rotation: next } } })) finish(false);
  }

  function finish(commit: boolean): void {
    const d = drag;
    drag = null;
    if (d && (d.kind === "move" || d.kind === "resize" || d.kind === "rotate")) {
      if (commit) core.commitTransaction();
      else core.cancelTransaction();
    }
    core.setChrome({ dragging: false, guides: [], marquee: null });
  }

  return {
    pointerDown(e) {
      if (e.button === 1 || (e.button === 0 && space)) {
        drag = { kind: "pan", last: { x: e.x, y: e.y } };
        return;
      }
      if (e.button !== 0) return;
      core.setChrome({ notice: null });
      const s = core.getState();
      const handle = singleHandle(e);
      if (handle) {
        const id = s.selection[0]!;
        const start = startOf(id);
        core.beginTransaction();
        core.setChrome({ dragging: true, hover: null });
        if (handle === "rotate") {
          const centre = apply(start.world, { x: 0, y: 0 });
          const p = world(e);
          drag = { kind: "rotate", id, start, centre, fromAngle: (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI };
        } else {
          const axisAligned = Math.abs(start.world[1]) < 1e-9 && Math.abs(start.world[2]) < 1e-9;
          drag = { kind: "resize", handle, id, start, snapper: axisAligned ? createSnapper(s.doc, new Set([id])) : null };
        }
        return;
      }
      const p = world(e);
      const hit = hitTest(s.doc, p);
      if (!hit) {
        if (!e.shift) core.select([]);
        drag = { kind: "marquee", from: p, base: e.shift ? [...s.selection] : [] };
        return;
      }
      const target = topLevelOf(s.doc, hit);
      if (e.shift) {
        core.select(s.selection.includes(target) ? s.selection.filter((id) => id !== target) : [...s.selection, target]);
        return;
      }
      if (!s.selection.includes(target)) core.select([target]);
      drag = { kind: "press", at: p, ids: [...core.getState().selection] };
    },

    pointerMove(e) {
      const d = drag;
      if (!d) {
        hoverHandle = singleHandle(e);
        const s = core.getState();
        const hit = hoverHandle ? null : hitTest(s.doc, world(e));
        const hover = hit ? topLevelOf(s.doc, hit) : null;
        if (hover !== s.hover) core.setChrome({ hover });
        return;
      }
      switch (d.kind) {
        case "pan": {
          const v = view();
          core.setChrome({ viewport: { ...v, panX: v.panX + e.x - d.last.x, panY: v.panY + e.y - d.last.y } });
          d.last = { x: e.x, y: e.y };
          return;
        }
        case "press": {
          const p = world(e);
          if (Math.hypot(p.x - d.at.x, p.y - d.at.y) * view().zoom < DRAG_THRESHOLD) return;
          const moving = beginMove(d);
          drag = moving;
          return moveTo(moving as Extract<Drag, { kind: "move" }>, e);
        }
        case "move":
          return moveTo(d, e);
        case "resize":
          return resizeTo(d, e);
        case "rotate":
          return rotateTo(d, e);
        case "marquee": {
          const p = world(e);
          const box = { minX: Math.min(d.from.x, p.x), minY: Math.min(d.from.y, p.y), maxX: Math.max(d.from.x, p.x), maxY: Math.max(d.from.y, p.y) };
          core.select([...d.base, ...nodesInBox(core.doc, box)]);
          core.setChrome({ marquee: box });
          return;
        }
      }
    },

    pointerUp() {
      finish(true);
    },

    wheel(e) {
      const v = view();
      if (e.zoom) core.setChrome({ viewport: zoomAt(v, e, v.zoom * Math.exp(-e.deltaY * 0.01)) });
      else core.setChrome({ viewport: { ...v, panX: v.panX - e.deltaX, panY: v.panY - e.deltaY } });
    },

    setSpace(held) {
      space = held;
    },

    cancel() {
      finish(false);
    },

    cursor() {
      if (drag?.kind === "pan" || space) return drag?.kind === "pan" ? "grabbing" : "grab";
      const h = drag?.kind === "resize" ? drag.handle : drag?.kind === "rotate" ? "rotate" : hoverHandle;
      if (h === "rotate") return "crosshair";
      if (h) return CURSORS[h];
      return drag?.kind === "move" ? "move" : "default";
    },
  };
}
