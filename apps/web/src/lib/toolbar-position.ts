interface Point {
  x: number;
  y: number;
}
interface Size {
  width: number;
  height: number;
}
interface Anchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Keeps `value` within [margin, room - size - margin]; when there is not enough room it sits at the margin. */
const clampStart = (value: number, size: number, room: number, margin: number) => Math.max(margin, Math.min(value, room - size - margin));

/**
 * Where the floating toolbar goes, in the canvas's own pixels. `points` are the selection frame's handles
 * (the rotate handle included), so the toolbar clears all of them: above by `gap`, centred on the frame.
 * With no room above it goes below; with room in neither place it stays at the top, over the selection.
 * Always kept `margin` inside the view, on every branch. Returns null when there are no points.
 */
export function placeToolbar(points: readonly Point[], toolbar: Size, view: Size, o: { gap?: number; margin?: number } = {}): { x: number; y: number; side: "above" | "below" } | null {
  if (points.length === 0) return null;
  const gap = o.gap ?? 10;
  const margin = o.margin ?? 8;
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const x = clampStart((minX + maxX) / 2 - toolbar.width / 2, toolbar.width, view.width, margin);
  const y = (value: number) => clampStart(value, toolbar.height, view.height, margin);

  const above = minY - gap - toolbar.height;
  if (above >= margin) return { x, y: y(above), side: "above" };
  const below = maxY + gap;
  if (below + toolbar.height <= view.height - margin) return { x, y: y(below), side: "below" };
  return { x, y: y(above), side: "above" };
}

/** Where a popover opened from `anchor` goes, in window pixels: centred under it, above when there is no room below, inside the window. */
export function placePopover(anchor: Anchor, popover: Size, view: Size, o: { gap?: number; margin?: number } = {}): Point {
  const gap = o.gap ?? 6;
  const margin = o.margin ?? 8;
  const x = clampStart((anchor.left + anchor.right) / 2 - popover.width / 2, popover.width, view.width, margin);
  const below = anchor.bottom + gap;
  if (below + popover.height <= view.height - margin) return { x, y: below };
  const above = anchor.top - gap - popover.height;
  return { x, y: above >= margin ? above : clampStart(below, popover.height, view.height, margin) };
}
