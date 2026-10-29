# Object controls, batch 2: floating toolbar and a better Layers panel

Part of `2026-10-07-canva-parity-roadmap.md` (S2 batch 2), without schema changes. Borders, shadows and alt text
need new document fields and come in a later batch. Approved by the owner in chat on 2026-10-07.

## Floating toolbar

A small toolbar that floats just above the current selection on the canvas, like Canva's.

- Shown when at least one layer is selected and the person is not dragging, resizing, rotating, marquee-selecting
  or editing text. It follows the selection when the canvas pans or zooms, sits above the selection frame (and the
  rotate handle), flips below it when there is no room, and is kept inside the canvas area.
- Buttons (lucide icons, `aria-label`, tooltip with shortcut, disabled reason exposed like the Arrange buttons):
  Duplicate, Copy style, Paste style, Transparency (a popover with a 0 to 100 slider; dragging previews as one
  transaction and commits as one undo step), Lock/Unlock, Arrange (a popover with the six aligns and the four order
  moves), Delete, and More (opens the same menu as right-click, anchored to the button).
- All buttons run existing registry actions, so labels, shortcuts and disabled reasons match the menus.
- Keyboard: the toolbar is reachable with Tab after the canvas; Escape inside it returns focus to the canvas.
  Pointer events on the toolbar never reach the canvas.
- Glass look (`glass-btn`/tokens), rounded rectangle (12px), light and dark mode.

## Layers panel

- **Drag to reorder:** drag a row up or down among its siblings; a line shows where it will land. Dropping moves the
  layer (one undo step) through an engine plan `planMoveLayer(doc, id, index, mode)` that uses `reorder` and the lock
  policy. Moving into or out of a group is out of scope: the drop line only appears among siblings.
  Keyboard alternative: Alt+ArrowUp / Alt+ArrowDown on a focused row moves it one step.
- **Rename:** double-click a layer name (or press F2 on a focused row) to edit it inline. Enter or clicking away
  saves, Escape cancels; empty names are refused; the schema's name limit applies. One undo step (`update` with
  `name`). A locked layer gives the policy's reason.
- **Collapse and expand groups:** a chevron on group rows; collapsed state is UI-only (not saved). Groups start
  expanded. Selecting a hidden child through the canvas expands its group.
- **Lock toggle in the row:** a lock button next to the eye, visible on hover or focus and always visible when the
  layer is locked; it runs the same toggle as Alt+Shift+L for that one layer.
- Row names fall back to a readable type name ("Text", "Shape", "Photo", "Sticker", "Group") instead of the raw type.

## Testing

Engine tests for `planMoveLayer` (up, down, to ends, no-op refusal "Already there.", locked layers, other parents
refused). Web tests for pure helpers (drop index maths, toolbar placement maths). Typecheck, lint, all tests, and a
real-browser check.
