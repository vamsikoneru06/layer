# Editing tools roadmap: matching Canva's editor

The owner wants VASH's editing tools to match Canva's. This is the batch order, building on the S1 to S9 split in
`2026-09-29-editor-shell-design.md`. It matches what the tools do, not Canva's look, brand or content library:
VASH keeps its own Liquid Glass design, and every rule in AGENTS.md still applies (free services only, no AI
images, honest copy, self-hosted assets).

Each batch gets its own short spec, approval, branch and PR.

## Done or in review

| Batch | What | Where |
|---|---|---|
| S1 | Menus, rename, Ctrl+S, toasts, zoom bar, right-click menu, cut/copy/paste, duplicate, group | PR #36 |
| S2 batch 1 | Layer order, align, distribute, flip, lock, copy and paste style | PR #44 (stacked on #36) |
| Frames, photo crop, text options | Photos in frames; move, zoom and swap photos; text styles and case | PRs #30, #32, #34 (other sessions) |

## Next, in order

1. **S2 batch 2, object finish:** border style (dashed, dotted), corner radius on every shape, drop shadow, layer
   transparency slider in a floating toolbar over the selection, layer drag to reorder, rename and collapse groups
   in the Layers panel, alt text. Needs schema additions (shadow, border dash, alt text) and a migration.
2. **S6, elements:** lines and arrows (with end caps), more shapes (star, polygon, heart, speech bubble), icons
   from lucide (self-hosted SVG paths), simple tables and grids. Needs new node or shape kinds in the schema.
3. **S3, canvas:** rulers, draggable guides, grid, margins, bleed and safe area, snap toggles, smart spacing
   guides, hand tool, fit width, page background image.
4. **S4, text (after #34 lands):** lists, heading presets, text effects (outline, shadow, curve, highlight),
   font size steps, more fonts in the allowlist.
5. **S5, image (after #30 and #32 land):** flip already done; duotone, pixelate, background blur, replace photo,
   reset adjustments, more filter presets.
6. **S7, export:** JPG with quality, PDF, transparent PNG, size options (1x, 2x), file size estimate, crop marks.
7. **S8, sharing and versions:** share window, view-only link, version history with restore.

## Needs an owner decision first

- **Multi-page (S9):** reverses spec section 2.2 and changes the document format.
- **Real-time collaboration and comments:** needs a realtime service; must be free tier.

## Not planned

- AI tools (Magic Write, background remover via AI, AI images): the owner's rules forbid AI-generated images, and
  any AI text tool needs a free service decision.
- Video, audio and animation timelines: VASH exports still images.
- Canva's own templates, photos, fonts and brand kit: VASH uses its own and open-licence content.
