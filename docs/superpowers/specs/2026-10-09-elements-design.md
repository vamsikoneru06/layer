# Elements: more shapes, lines, arrows and icons

S6 of `2026-10-07-canva-parity-roadmap.md`, first batch. No schema change: everything uses the existing shape
geometries (`rect`, `ellipse`, `polygon` with 3 to 64 sides, and `path`, an SVG path in a 0 to 1 unit box that is
stretched to the layer's width and height and validated by `validatePathData`).

## What people get

The Shapes panel in the left rail grows into three sections:

1. **Shapes** (filled, grey `#C7C7CC` like today): rectangle, rounded rectangle, circle, triangle (existing), plus
   diamond, pentagon, hexagon, octagon, star (5 points), heart, plus/cross, right arrow (block arrow), left arrow,
   up arrow, down arrow, double arrow, chevron, speech bubble, cloud, half circle, parallelogram, trapezoid.
2. **Lines and arrows** (no fill, dark stroke `#1C1C1E`, width scaled to the layer, e.g. 4 px on a 300 px line):
   straight line, line with arrow at the end, line with arrows at both ends, line with a circle end, elbow line.
   Inserted wide and short (for example 300 by 40) so they look like lines.
3. **Icons** (no fill, dark stroke, outline style): about 48 everyday icons taken from lucide (the icon set the app
   already uses, ISC licence; its notice is kept in the generated file): heart, star, check, x, plus, minus, arrow
   right, arrow up right, phone, mail, map pin, calendar, clock, camera, image, music, home, user, users, shopping
   bag, shopping cart, gift, cake, coffee, sun, moon, cloud, umbrella, leaf, flower, globe, link, share, bell,
   message circle, thumbs up, smile, sparkles, zap, flame, crown, award, trophy, graduation cap, briefcase,
   no brand logos. A search box filters icons by name.

Each tile shows a small SVG preview drawn from the same geometry, has an accessible name, and inserts the element
centred on the page, selected, as one undo step (through the existing insert path and layer cap).

## Pieces

- `apps/web/src/lib/shape-catalog.ts`: the Shapes and Lines and arrows entries as plain data
  `{ id, name, geometry, width, height, fill: boolean, strokeWidth: number | null }`, plus a test that validates
  every path with `validatePathData` and every polygon against the limits.
- `apps/web/src/lib/icon-paths.ts`: generated icon data (`{ id, name, d }` in the unit box, stroke-only), produced
  by `apps/web/scripts/build-icons.ts` from lucide's icon node data (circles, rects, lines, polylines, ellipses and
  paths converted to path data, then scaled from 24 by 24 to 0 to 1). A test validates every `d`.
- Engine: `insertShape(core, spec)` in `insert.ts` that takes `{ name, geometry, width, height, fill, stroke }`
  (schema types), places it centred, selects it, honours the layer cap, one undo step; tests.
- UI: `insert-rail.tsx` Shapes panel with the three sections and the icon search, using the catalogues and
  `insertShape`.

## Testing

Unit tests for the catalogues (every geometry valid), the engine insert, and the icon conversion; typecheck, lint,
all tests; a browser check that each section inserts and renders.
