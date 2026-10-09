# More tools: photo effects, curved text, design colours, resize, zoom keys

Next batch from `2026-10-07-canva-parity-roadmap.md` (S4 and S5 items plus Canva conveniences). Optional document
fields only, so every existing design and template stays valid with no migration.

## 1. Photo effects (S5)

- **Duotone:** maps a photo's light and dark tones to two chosen colours (switch, highlight colour, shadow colour).
  Optional `Filters.duotone?: { light: Color; dark: Color } | null`.
- **Pixelate:** a slider 0 to 100 (0 off) that turns the photo into blocks. Optional `Filters.pixelate?: number`.
- **More presets:** six more looks next to the existing filter presets (names must not repeat existing ones), each
  a set of the existing adjustment values.
- Implemented in the WebGL2 filter pipeline (`packages/engine/src/filters.ts`) so the canvas and exports match; when
  WebGL2 is unavailable the photo draws without the effect, as other filters do today.

## 2. Curved text (S4)

- A **Curve** slider from -100 to 100 in the Effects group (0 straight). Positive bends the text into an arch, negative
  into a smile. Works for single lines; multi-line text curves each line around the same centre with its line
  spacing. Optional `TextNode.curve?: number`.
- Drawn by placing each grapheme along the arc (rotate per character), with outline, highlight off for curved
  text (the highlight band does not follow a curve; the switch says so when disabled).

## 3. Design colours and recent colours

- The colour picker shows **Design colours** (every distinct colour used in the design: fills, strokes, text,
  backgrounds, gradient stops, shadows, outlines, up to 16, most used first) and **Recent** (the last 8 colours picked
  in this browser, kept in localStorage). Click a swatch to apply it.

## 4. Resize design

- File > **Resize design**: pick a format (the existing formats) or a custom width and height, and choose
  "Scale content to fit" (default; every top-level layer is scaled and repositioned so the layout keeps its look,
  centred) or "Keep content as it is". One undo step through an engine plan (artboard plus transform updates; text
  sizes scale with the content). Templates' lock policy still applies.

## 5. Zoom keys

- Ctrl+= (or Ctrl++) zoom in, Ctrl+- zoom out, Ctrl+0 fit to screen, Ctrl+1 actual size (100%). Shown in the
  shortcuts dialog and the View menu; the browser's own page zoom is prevented only while the editor has focus.

## Testing

Schema validation tests for the new optional fields; engine tests (filter uniforms, curved text glyph placement with
the recording context, resize plan maths and one undo step); colour extraction helper tests; typecheck, lint, all
tests; export-pixel checks in the browser for duotone, pixelate and curved text.
