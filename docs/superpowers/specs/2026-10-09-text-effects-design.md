# Text effects: outline, highlight and lists

S4 of `2026-10-07-canva-parity-roadmap.md`, first batch. Builds on the text styles from #34 and the layer shadow
from the shadows batch (text already casts a shadow). Optional document fields only, so every existing design and
template stays valid with no migration.

## What people get

In the Properties panel's Text section, a new **Effects** group:

- **Outline:** a switch, a colour and a width (1 to 20 px). The outline is drawn behind the letters so the fill
  stays crisp (stroke first, then fill).
- **Highlight:** a switch and a colour. A rounded band behind each line of text, padded a little (about 0.15 of the
  font size), like a marker.
- **List:** None, Bullets, Numbers. Each paragraph (line typed with Enter) starts with "•" or "1.", "2.", ... with
  a hanging indent so wrapped lines align with the text, not the marker. The text itself is unchanged (markers are
  drawn, not typed), so editing and character limits work as before.

Copy style carries outline, highlight and list. Everything renders the same on the canvas and in exports.

## Document fields (optional)

TextNode: `outline?: { color: Color; width: number } | null` (width 0 to `LIMITS.textOutlineMax` = 20),
`highlight?: { color: Color } | null`, `list?: "none" | "bullet" | "number"`.

## Testing

Schema validation tests; engine render tests with the recording context (stroke before fill, highlight rectangles
per line, list markers and indent); layout tests for the hanging indent; panel typecheck and lint; export-pixel
check in the browser.
