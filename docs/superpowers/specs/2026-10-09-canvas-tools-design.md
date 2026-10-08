# Canvas tools: rulers, guides, grid and snapping switches

S3 of `2026-10-07-canva-parity-roadmap.md`, first batch. No schema change: guides and view settings are kept per
design in this browser (localStorage), not in the document.

## What people get

- **Rulers** along the top and left of the canvas, in design pixels, following zoom and pan. Ticks every 1, 2, 5,
  10, 20, 50, 100... units, chosen so labels sit at least about 60 screen px apart. The page area (0 to width,
  0 to height) is shown slightly brighter on the ruler. View > Show rulers (Shift+R).
- **Guides:** drag from the top ruler to make a horizontal guide, from the left ruler for a vertical one. Drag a
  guide to move it; drag it back onto its ruler to remove it. Guides are thin lines in a clear accent colour drawn
  over the design (not exported). While dragging a guide its position shows next to the pointer. View > Show
  guides, View > Clear guides. Guides are kept per design in this browser.
- **Grid:** View > Show grid draws a square grid over the page every 50 design px (lighter lines every 10 when
  zoomed in far enough that they are at least 8 screen px apart). Not exported.
- **Snapping switches:** View > Snap to objects (layers and the page edges and centre, today's behaviour, on by
  default) and View > Snap to guides (on by default). Moving and resizing snaps to visible guides when it is on.
- Menu items that toggle show their state in the label ("Show rulers" / "Hide rulers"), like "Hide panels" today.
  Settings are remembered per browser.

## Pieces

1. Engine: snapping options. `EditorCore` holds `snap: { objects: boolean; guides: { x: number[]; y: number[] } }`
   with a setter; `createSnapper` takes these options (objects off means only guides; guide targets span the whole
   artboard); `interaction.ts` passes them. Tests.
2. Web: `lib/ruler-ticks.ts` (pure tick maths) and `components/editor/ruler.tsx` (top and left rulers).
3. Web: `lib/guides.ts` (pure helpers and per-design localStorage, wrapped in try/catch) and
   `components/editor/canvas-overlay.tsx` (guides and grid drawn in screen space over the canvas; only guide lines
   take pointer events).
4. Web: wiring in `workspace.tsx`, View menu actions in `editor-actions.ts`, Shift+R.

## Testing

Unit tests for tick maths, guide helpers and storage, and the engine snapping options; typecheck, lint, all
tests; a browser check that rulers follow zoom, a guide can be dragged out, snapped to and removed, and the grid
toggles.
