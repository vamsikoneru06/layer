# Object controls, batch 1: arrange, align and style tools

Sub-project S2 of `2026-09-29-editor-shell-design.md`, first batch. Approved by the owner in chat on 2026-10-07.
Builds on the editor shell (action registry, plans, `runPlan`), so this branch stacks on `feat/editor-shell-pr`.

## Goal

The editor has too few tools. This batch adds the object tools people reach for constantly, in the menus, the
right-click menu, the Properties panel and on the keyboard. No schema change: shadows, borders, alt text,
a floating toolbar and layer drag are later batches.

## Tools

| Tool | Behaviour | Shortcut |
|---|---|---|
| Bring forward / Send backward | Each selected layer moves one step past its next unselected sibling. Selected layers keep their order relative to each other. | Ctrl+] / Ctrl+[ |
| Bring to front / Send to back | Selected layers move to the top (or bottom) of their sibling list, keeping their relative order. | Ctrl+Shift+] / Ctrl+Shift+[ |
| Align left, centre, right, top, middle, bottom | One layer aligns to the page (artboard). Several align to the bounding box of the selection. Uses each layer's visible (world, axis-aligned) box, so rotated layers line up as they look. Only position changes. | none |
| Distribute horizontally / vertically | Three or more layers: the outermost two stay, the rest move so the gaps between visible boxes are equal. | none |
| Flip horizontal / vertical | Negates the layer's own `scaleX` / `scaleY` (its centre stays put). Text, and groups containing text, are refused: "Text can't be flipped." | none |
| Lock / Unlock | If every selected layer is free, locks them; otherwise unlocks the locked ones. The lock policy decides what is allowed. The label reads "Lock" or "Unlock". | Alt+Shift+L |
| Copy style / Paste style | Copies the style of one selected layer (everything except identity, geometry and content: see below) and pastes it onto selected layers of the same type. Layers of another type are skipped and the notice says how many. | Ctrl+Alt+C / Ctrl+Alt+V |

Style fields: every node field except `id`, `type`, `name`, `lock`, `visible`, `transform`, `width`, `height`,
children, text content, and asset/photo references and crop. The exact list per node type is defined next to the
node types in the engine, with a test that pins it.

## Rules (same as the shell)

- Every tool is a plan builder (`Plan` from `selection-utils.ts`) that returns one command (usually a `batch`), so
  it is one undo step, runs through `runPlan` (validator, then `dispatch`, which applies the lock policy) and keeps
  the selection.
- A plan that cannot run returns a short plain reason. That reason is the action's `disabled` text, so menus,
  the right-click menu and Properties buttons all explain themselves. Examples: "Select a layer first.",
  "Already at the front.", "Already aligned.", "Select three or more layers to distribute.",
  "Text can't be flipped.", "Copy a style first.", "The template locks this layer's position."
  (the policy's own reason).
- Plans act on the top-level selection (`topLevelSelection`). Layers inside a group are moved in their parent's
  space: a world-space shift is converted with the inverse of the parent's world matrix.
- Results must stay within the schema limits; the validator in `runPlan` is the backstop.
- No em dashes in any user-visible text.

## Where they appear

- New **Arrange** menu between Edit and View: Bring forward, Bring to front, Send backward, Send to back,
  separator, the six aligns, separator, Distribute horizontally, Distribute vertically, separator,
  Flip horizontal, Flip vertical, separator, Lock/Unlock.
- **Edit** menu: Copy style and Paste style after Paste.
- **Right-click on a layer:** adds Copy style, Paste style, separator, Bring forward, Bring to front, Send backward,
  Send to back, separator, Flip horizontal, Flip vertical, Lock/Unlock.
- **Properties panel:** a **Position** section shown whenever at least one layer is selected (including several),
  with icon buttons (lucide-react) for the six aligns, two distributes, four order moves and two flips. Each button
  has an `aria-label`, and its tooltip shows the disabled reason when disabled.
- **Keyboard shortcuts dialog:** lists the new shortcuts (it reads the registry).

## Testing

- Engine unit tests per plan builder: normal cases, multi-select order, groups (children in a rotated parent),
  rotated layers for align, refusals and their reasons, locks, one-undo-step, limits.
- Registry tests: the new actions, their disabled reasons, the Arrange menu layout, the lock label.
- Typecheck, lint, all tests; a real-browser check of the menus, panel buttons and shortcuts.

## Build steps

1. Engine: `arrange.ts` (order, align, distribute, flip, lock) and `style.ts` (style fields, copy, paste plan),
   wrappers in `edit-ops.ts`, shortcuts in `shortcuts.ts`, exports in `index.ts`, tests.
2. Web: registry actions and layouts, the Arrange menu in the menu bar, the Position section, tests.
3. Review, fixes, browser check, PR.
