# Editor shell: design spec

Status: draft for owner review. Date: 2026-09-29.
Parent product spec: `2026-09-24-vash-design.md`. This document covers sub-project 1 in detail and maps the
owner's full editor feature list (28 numbered areas, pasted 2026-09-29) onto sub-projects, so nothing on the list is lost.

## 1. Purpose

The owner asked for the editing window to cover the full feature set of a Canva-class editor. That is too large
for one spec, so it is split into sub-projects (section 2). Each sub-project gets its own spec, plan and build,
ships with tests, and is checked in a real browser.

This spec details **sub-project 1, the editor shell**: the frame around the canvas (header, menus, bottom bar,
right-click menu, shortcuts, toasts) plus the basic edit commands those menus need (cut, copy, paste, duplicate,
group, ungroup).

Success criteria:
- Every control the shell shows does something real. No disabled placeholders, no dead menu items.
- The same action behaves the same from the menu, the right-click menu and the keyboard.
- Engine commands and the shell logic have tests; the UI is checked in a browser in light and dark mode.
- Copy follows the design rules in `AGENTS.md` (no em dashes, no emoji, no pill buttons, plain honest text).

## 2. Roadmap

| # | Sub-project | Summary |
|---|---|---|
| S1 | **Editor shell** (this spec) | Header, File/Edit/View/Help menus, rename, Ctrl+S, toasts, bottom bar, right-click menu, edit commands |
| S2 | Object controls | Arrange, align, distribute, border style, shadow, floating toolbar, copy/paste style, alt text, contrast warnings, layer drag, rename and collapse (lock, opacity and position fields already exist) |
| S3 | Canvas and guides | Rulers, guides, margins, bleed, safe area, grid, smart guides, snap toggles, pan tool, fit width, artboard resize, page background |
| S4 | Text | Spacing, lists, case, heading presets, text effects, font collections |
| S5 | Image | Crop, flip, duotone, pixelate, replace, reset (adjustments and vignette already exist) |
| S6 | Elements library | Lines, arrows, more shapes, icons (lucide), gradients, grids, tables, charts |
| S7 | Export | JPG, PDF, SVG, transparent background, quality, crop marks, size estimate |
| S8 | Sharing and versions | Share window, view links, public or private, download permission, version history |
| S9 | Multi-page | Pages panel and page controls. Needs an owner decision first: it reverses spec section 2.2 and changes the document schema |
| Later | Not yet scheduled | Items that fit the product but belong to product phases P2/P3 or to a slice not yet planned |
| Deferred | Blocked | Items that break a hard rule in `AGENTS.md` or spec 2.2 (paid or AI, video and audio, real-time collaboration, third-party content). Revisit only with an owner decision |

Build order: S1, S2, S3, S4, S5, S6, S7, S8, then S9 if approved.

## 3. S1 design

### 3.1 Approach

One **action registry**. Each editor action (Duplicate, Group, Rename, Fullscreen and so on) is defined once with
its id, label, shortcut, an `enabled(state)` rule with an optional reason, and a `run` function. The File, Edit,
View and Help menus, the right-click menu, the keyboard dispatcher and the shortcuts dialog are all generated from
the registry. A control cannot appear in one place and be dead in another.

Rejected: wiring every menu and shortcut by hand. Faster to start, but the enable rules get copied and drift.

### 3.2 Engine (`packages/engine`)

- New commands `group` and `ungroup`, each one undo step. Group children are stored relative to the group centre
  (engine convention), so grouping re-expresses child transforms against the new centre, and ungrouping applies the
  group transform back into each child.
- Duplicate: deep clone with fresh ids and a small offset, as one undo step.
- Clipboard payload: a pure function turns a selection into a serialized subtree of nodes plus the asset ids they
  use. Never URLs. Paste builds an `insert` batch with fresh ids and an offset.
- Paste re-validates the payload with the same `@vash/schema` validator the server uses, including limits.
  Asset ids in a pasted payload are only kept if the design already references them, otherwise the node is
  dropped and the user gets a toast. This stops a crafted clipboard from referencing another user's assets.
- The lock policy in `policy.ts` applies to every new command. Locked nodes cannot be cut, deleted, grouped or
  ungrouped. Copy of a locked node is allowed in design mode.
- `shortcuts.ts` gains Ctrl+D, Ctrl+G and Ctrl+Shift+G. Copy, cut and paste use DOM events (section 3.3), because
  key handlers cannot read the system clipboard reliably.

### 3.3 Web (`apps/web/src/components/editor`)

New files, each small and single-purpose:

| File | Purpose |
|---|---|
| `editor-actions.ts` | The registry and the `enabled` rules |
| `title-field.tsx` | Inline rename in the header, saved with the existing `renameDesign` |
| `menu-bar.tsx` | File, Edit, View, Help menus generated from the registry |
| `context-menu.tsx` | Right-click menu at the pointer. Selects the layer under the pointer first |
| `shortcuts-dialog.tsx` | Shortcut list generated from the registry |
| `design-info-dialog.tsx` | Size, format, layer count, last saved. Real data only |
| `use-clipboard.ts` | `copy`, `cut`, `paste` event handling and the fallback buffer |

`workspace.tsx` is left as the composer and does not grow.

Behaviour:
- **Clipboard:** the payload is written to the system clipboard as text with a `vash:` prefix, so it works across
  tabs. If the clipboard is blocked, an in-memory copy is the fallback. Pasted text that is not a valid payload is
  ignored with a toast, "Nothing to paste." Image paste from the clipboard belongs to the Photos work
  (`docs/superpowers/plans/2026-09-27-p1-editor-m2.md`, Task 5), not S1.
- **Rename:** trimmed, length limited, reverts on failure with an error toast. An unsaved rename is never lost on
  navigation. The header title and `doc.meta.title` must not disagree; the spec plan step verifies how the server
  stores the title and updates both if needed.
- **Ctrl+S:** flushes the autosaver, shows the result as a toast, and suppresses the browser's Save dialog.
- **Toasts:** the single `notice` line in `workspace.tsx` is replaced by the existing `ui/toast` (queued, supports
  an action such as Undo).
- **Fullscreen and Hide panels:** Fullscreen uses the Fullscreen API on the editor root. Hide panels collapses the
  side rail, the right panel and the bottom bar, and Escape restores them. This is also what the list calls
  Preview and Hide UI.
- **Zoom:** the header Zoom menu is removed. The bottom bar keeps zoom out, zoom in, the percentage, Fit, and gains
  a zoom slider. Zoom limits come from `viewport.ts`.
- **Save status:** already implemented (saved, unsaved, saving, offline, retrying, signed-out, error, conflict).
  S1 keeps it and adds nothing.
- **Design settings and info:** Design info dialog only. Guides and units settings arrive with S3.

Menus in S1 (only actions that work):
- **File:** New design, Open (Your designs), Make a copy (`duplicateDesign`, then open the copy), Rename, Move to
  folder (`moveDesign` and `listAllFolders`), Design info, Download (opens the existing Export popover).
- **Edit:** Undo, Redo, Cut, Copy, Paste, Duplicate, Delete, Select all, Group, Ungroup.
- **View:** Zoom in, Zoom out, Fit, Fullscreen, Hide panels.
- **Help:** Keyboard shortcuts.
- **Right-click menu:** Cut, Copy, Paste, Duplicate, Delete, Group, Ungroup. Later slices add Arrange, Lock, Copy
  style, Replace image and so on (see section 5, list item 25).

### 3.4 Errors and edge cases

- Nothing usable to paste: toast "Nothing to paste."
- Locked layer selected: Cut, Delete, Group and Ungroup are disabled and the reason is available as a tooltip.
- Clipboard permission denied: fall back to the in-memory buffer, no error shown.
- Rename fails: title reverts, error toast.
- Make a copy fails: error toast, the current design is untouched.
- Fullscreen unsupported or refused: the menu item is hidden or a toast explains, no exception.
- Keyboard focus in a text field (rename, properties panel, text editor): design shortcuts do not fire.

### 3.5 Testing

- Engine: group and ungroup round trip and undo, duplicate, clipboard round trip, lock policy, invalid and hostile
  payloads (bad schema, foreign asset ids, oversized).
- Web unit: registry `enabled` rules, shortcut dispatcher (including focus in inputs), rename validation and
  revert, clipboard fallback.
- Browser check in light and dark mode: each menu item, right-click on a node and on empty canvas, Ctrl+S,
  fullscreen, Hide panels, rename. Use `editor.exportPng()` or DOM state for canvas checks, not screenshots
  (the editor draws on `requestAnimationFrame`, see `AGENTS.md`).
- `corepack pnpm -r test`, `corepack pnpm typecheck` and `corepack pnpm lint` pass before the PR.

### 3.6 Legal, security, cost

- No new data is collected or stored, so `/terms` and `/privacy` do not change.
- No new service, so nothing to add to `docs/free-stack.md`. Everything is free.
- The clipboard payload is validated on paste and again on save, so it adds no new trust boundary.

### 3.7 Out of scope for S1

Version history (S8), notifications, collaborators, Present and Publish (see section 5), disabled placeholder
buttons for any of these, and keyboard shortcuts for features that do not exist yet.

## 4. Status legend for section 5

- **Exists**: already in the app today.
- **S1 to S9**: built in that sub-project.
- **Later**: fits the product, not yet scheduled.
- **Deferred**: blocked by a hard rule; reason given.

## 5. Coverage of the owner's full list

The list numbering skips 18 in the original message. It is kept as given.

### 1. Top header / navigation
- Exists: Design title (read-only), Save status, Undo, Redo, Download (Export popover)
- S1: Logo (the VASH logo, not another brand's), Home (logo links to Your designs), File menu, Rename design, Design
  settings (Design info), Help, Preview (Hide panels), More menu (covered by File, Edit, View, Help)
- S3: Resize
- S8: Version history, Share
- Later: Publish (product phase P3, needs moderation and reporting first)
- Deferred: Magic Switch and Transform (AI, paid; a plain resize covers the non-AI part), Notifications and
  Collaborators (need real-time collaboration, out of scope in spec 2.2), Present (slides and animation, out of scope)

### 2. Left main sidebar
- Exists: Insert rail (text, shapes, photo frames), Your designs, Uploaded files (Media page), Folders
- S4: Add heading, subheading, body text, text combinations, font collections
- S6: Shapes, Lines, Arrows, Icons, Frames, Grids, Charts, Tables, Gradients
- Later: Templates panel inside the editor, Layouts, Styles, Recently used designs, Stickers library, Photos panel
  with Pexels search (planned as M2 Task 5), Recent uploads, Draw tools (pen, marker, highlighter, eraser, colors,
  brush size; freehand path nodes fit the schema), saved brand colors and fonts (a free "saved colors and fonts"
  version of Brand)
- Deferred: Design suggestions, AI-generated elements, AI tools (AI, paid); Graphics, Illustrations, 3D elements,
  Brand logos and templates and guidelines, Canva apps and Integrations and External services (third-party content
  or services, no honest free source); Videos and Audio (out of scope); Dynamic text (needs data sources);
  Documents and Uploaded fonts (fonts are self-hosted and allow-listed by the CSP, so user fonts are blocked)

### 3. Main canvas area
- Exists: Artboard, background, objects, text, images, frames, shapes, groups (schema), zoom, fit, snapping
- S1: Zoom in and out, zoom percentage, Fit to screen, Fullscreen
- S3: Fit width, Hand tool and Select tool, rulers, horizontal and vertical guides, margins, bleed area, safe area,
  grid, smart guides, alignment guides, spacing indicators
- Deferred: Videos (out of scope). Components (reusable component instances) need a schema change and are not scheduled

### 4. Object selection UI
- Exists: Bounding box, resize handles, rotation handle, corner and side handles, selection outline, shift-click
  multi-select (canvas and Layers panel)
- S3: Position, alignment and spacing indicators
- S1: Group, Ungroup
- S2: Align, Distribute, Space evenly. The S2 plan first checks what multi-select already does (marquee, shared
  bounding box) and only builds the gaps

### 5. Contextual toolbar
- Exists: Position, Size, Rotation, Opacity and Lock as fields in the Properties panel
- S1: Duplicate, Delete, Copy, Paste, Group, Ungroup (through the menus and shortcuts)
- S2: A floating toolbar over the selection that surfaces Position, Size, Rotate, Transparency, Lock, plus Copy style
  and Alt text
- Not applicable: Link. Designs export to PNG, so a hyperlink on an element could not be honoured

### 6. Text editing controls
- Exists (Properties panel): Font family, Weight (regular, bold and others the family has), Italic, Font size, Text
  color, Alignment left, center, right and justify, Line height, Letter spacing, Shrink text to fit. Text box width
  and height and rotation are in Position and size
- S4: One-click Bold, Underline, Strikethrough, Highlight, Uppercase, Paragraph spacing, Bullets, Numbered lists,
  Padding
- S4 effects: Shadow, Lift, Outline, Neon, Curve, Background, Echo, Splice, Glitch (each only if it renders
  correctly in Canvas2D and in PNG export; any that cannot are dropped and reported)
- Deferred: Text animation (animation is out of scope). Mixed styles inside one text layer are out of scope in spec
  2.2, so bold or color applies to the whole layer

### 7. Image editing controls
- Exists (Properties panel, frames): Filter presets, Brightness, Contrast, Saturation, Warmth (temperature), Tint,
  Highlights, Shadows, Vignette, Grain, Blur, Sharpen, all rendered in WebGL2. Also Position, Size, Rotation, Opacity
- S5: Crop, Flip horizontal and vertical, Duotone, Pixelate, Image effects (any beyond duotone and pixelate are
  chosen in the S5 spec), Replace image, Reset image (resets the filters and crop)
- Deferred: Background remover (out of scope, and a free in-browser model would be a large download needing a CSP
  review), Magic Eraser, Magic Edit, Autofocus (AI, paid)

### 8. Video editing controls
- Deferred, all items (Play, Pause, Timeline, Trim, Split, Crop, Speed, Volume, Fade, Playback, Video effects,
  Filters, Adjustments, Transitions, Animation, Duration, Replace video, Audio extraction): video is out of scope

### 9. Audio controls
- Deferred, all items: audio is out of scope

### 10. Shapes and graphics controls
- Exists: Fill color (a gradient fill is shown but only solid colors can be set), Border (stroke) color and width,
  Corner radius, Position, Size, Rotation, Transparency, Lock
- S2: Border style (dashed and so on), Shadow, Effects
- S1: Duplicate
- S6: Gradient fill editing

### 11. Position panel
- Exists: X, Y, Width, Height, Rotation, Opacity, in the "Position and size" section
- S2: Bring forward, Bring to front, Send backward, Send to back (the `reorder` command exists), Align left, center,
  right, top, middle, bottom, Distribute horizontally and vertically

### 12. Layers panel
- Exists: Layers list top first, select and shift-select, nested groups shown indented, Visibility toggle, lock
  indicator (the lock switch itself is in Properties)
- S2: Layer ordering by drag, Rename layer, Expand and collapse groups, a Lock toggle in the row

### 13. Pages panel
- S9 (pending owner decision): Page thumbnails, Page number, Add, Duplicate, Delete, Reorder, Rename page, Page
  background, Page notes
- Deferred: Page duration, Page transition, Page animation

### 14. Page-level controls
- S3: Background color, Background image, Transparency, Resize page
- S9: Duplicate page, Delete page, Page notes, More options
- Deferred: Background video, Animate page, Page transition, Set duration

### 15. Animation system
- Deferred, all items (page and element animation, direction, speed, intensity, delay, duration): animation is out
  of scope

### 16. Transitions
- Deferred, all items: same reason as animation

### 17. Comments and collaboration
- Deferred, all items (comments, replies, mentions, resolve, threads, avatars, live cursors, cursor names,
  collaboration status): real-time and multi-user editing is out of scope in spec 2.2. Live cursors would also need
  a rule review against the design rule on cursor animations
- Later: reporting a published template already belongs to product phase P3 (moderation)

### 19. File and document controls
- S1: New design, Open, Save (Ctrl+S), Make a copy, Rename, Move to folder, File information (Design info), Download
- S7: Export, Print
- S8: Version history, Design permissions, Share

### 20. Export and download window
- Exists: PNG with scale options
- S7: JPG, PDF Standard, PDF Print, SVG (needs a scene-to-SVG serializer; text and filters may not map exactly, so
  the plan step confirms feasibility and reports any gap), Transparent background, Compression, Quality, File size
  estimate, Crop marks, Bleed, Flatten PDF
- S9: Selected pages, All pages
- Deferred: MP4, GIF (video and animation), PPTX (large effort, low value, not scheduled)

### 21. Share window
- S8: Share link, Copy link, Viewer permission, Public or private access, Download permission
- Later: Template link (needs the publish flow)
- Deferred: Email invitation and Collaborators (need real-time collaboration and outgoing mail beyond sign-in links),
  Commenter and Editor permissions (collaboration)

### 22. View menu
- S1: Zoom, Fullscreen, Hide UI
- S3: Show rulers, Show guides, Show margins, Show bleed, Show grid, Snap to guides, Snap to objects, Show boundaries

### 23. Bottom toolbar
- Exists: Zoom out and in, zoom percentage, Fit
- S1: Zoom slider, Fullscreen, Help
- S9: Page navigation, Grid view of pages
- Deferred: Comments, Timeline toggle

### 24. Right-side panels
- Exists: Properties (includes Position and size, Transparency, Text, Shape and Filters sections), Layers
- S2: Color (document colors), Alt text, Accessibility
- S4: Effects (text)
- S5: Crop, Duotone, Pixelate (Adjust and Filters already exist)
- Deferred: Animation
- Not applicable: Link

### 25. Right-click context menu
- S1: Copy, Paste, Duplicate, Delete, Group, Ungroup (and Cut)
- S2: Bring to front, Bring forward, Send backward, Send to back, Lock, Unlock, Copy style, Paste style, Position
- S5: Replace image, Edit image
- Deferred: Add comment (collaboration)
- Not applicable: Add link

### 26. Keyboard and editing system
- Exists: Ctrl+Z, Ctrl+Y, Ctrl+A, Delete, arrow keys, Shift+arrow, Enter (edit text), Escape
- S1: Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+D, Ctrl+G, Ctrl+Shift+G, Ctrl+S

### 27. Accessibility
- Exists: Keyboard-accessible menus and Layers panel, labelled canvas
- S1: Focus indicators and keyboard navigation for every new menu and dialog
- S2: Alt text, Contrast checking and accessibility warnings, Screen-reader layer information

### 28. Status and system indicators
- Exists: Saving, Saved, Offline, Retrying, Error, Conflict, Signed-out states; loading skeleton
- S1: Toast messages, Error messages (the single notice line is replaced by toasts)
- S7: Exporting and Processing states
- Later: Uploading state, arrives with the Photos panel (M2 Task 5)
- Deferred: Notifications (see section 1)

## 6. Notes on the original request

The owner also wrote "without any error". No editor of this size can promise zero defects. What this process
commits to is tests for the engine and the shell logic, a browser check in light and dark mode for each slice, and
CI (lint, typecheck, tests, gitleaks, CodeQL, audit) passing before merge.

## 7. Open questions

1. S9 (multi-page) needs an owner decision because it reverses spec 2.2 and touches the document schema.
2. Additions beyond the design discussed in chat: File menu gets Open and Move to folder, because both use existing
   API calls and cost little. Say if you would rather leave them out of S1.
3. Whether any Deferred item should be pulled forward. Each would need its own cost and rule review first.
