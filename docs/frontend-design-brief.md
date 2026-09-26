# VASH — Frontend Design Brief

> **For Claude Design.** This document is self-contained: it describes the product, the brand direction, the design system, and all 15 pages with their layouts, content, states, and interactions. Please design **high-fidelity screens for every page listed in §6**, in **light and dark themes**, at the breakpoints in §4, plus the component sheet in §5. Where this brief proposes a visual value (colour, font, radius), treat it as a strong starting point, not a cage — push it if a better idea serves the product.

---

## 1. The product in one paragraph

**VASH** is a template-first photo design editor in the browser — think *Canva meets Instagram Stories*, focused on one thing done beautifully: **pick a template, drop your own photos into its frames, tweak text, stickers and filters, and export a crisp PNG.** No video. No account required to start. Creators can design their own templates in the same app ("Author Mode") and publish them to a public gallery that everyone can use and remix.

### Who uses it
| Person | What they want | What delights them |
|---|---|---|
| **Riya, 21, student** — making a birthday post for a friend | Finished in 2 minutes on her laptop, looks professional | Dropping 4 photos at once and watching them snap into the frames |
| **Arjun, 34, runs a café** — weekly offers poster + story | Consistent brand look, fast | Templates that don't break when he changes the text |
| **Meera, 27, designer** — publishes templates | Real design control, credit for her work | Lock controls, a gallery page and a profile that shows her template usage |
| **Admin** | Keep the gallery clean | A fast, keyboard-friendly moderation queue |

---

## 2. Brand & visual direction

### Personality
**Calm chrome, loud content.** The interface should feel like a well-lit studio: quiet, confident, precise — so the user's photos and templates are the most colourful thing on screen. Marketing pages (Landing, Gallery) can be more expressive and playful; the Editor must be restrained and dense-but-clear.

Keywords: *crafted, fast, friendly, precise, photo-first.*
Avoid: gradients-everywhere "AI startup" look, glassmorphism overload, cartoon illustrations, tiny low-contrast grey text.

### Name & logo idea
Wordmark "VASH", with a mark made of **three offset rounded rectangles stacked like layers** (slight rotation on the top one). The mark doubles as the app icon and favicon.

### Colour (proposed tokens)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FAFAF9` | `#111113` | App background |
| `--surface` | `#FFFFFF` | `#18181B` | Panels, cards |
| `--surface-2` | `#F4F4F2` | `#1F1F23` | Inputs, secondary panels, canvas pasteboard |
| `--border` | `#E6E5E1` | `#2A2A30` | Hairlines |
| `--text` | `#16161A` | `#F4F4F5` | Primary text |
| `--text-muted` | `#5F5E68` | `#A1A1AA` | Secondary text (must stay ≥ 4.5:1) |
| `--primary` | `#5B4BFF` | `#7B6DFF` | Primary actions, links, focus ring, **selection handles** |
| `--primary-contrast` | `#FFFFFF` | `#FFFFFF` | Text on primary |
| `--accent` | `#FFB547` | `#FFC56E` | "Featured" badges, highlights, onboarding sparkle |
| `--author` | `#FF7A45` | `#FF8F61` | **Author Mode** indicator (banner, lock badges) — must be unmistakable |
| `--success` | `#1F9D55` | `#34C774` | Saved, published |
| `--warning` | `#C98A00` | `#F5B83D` | PII warnings, quota near limit |
| `--danger` | `#D92D20` | `#F97066` | Destructive actions, errors |

Selection handles and snapping guides sit on arbitrary photos, so they need a **1 px white halo** (or dark halo in dark theme) to stay visible on any image. Snapping guides use a hot pink `#FF3EA5` so they never get confused with the selection colour.

### Typography (Google Fonts)
| Role | Font | Notes |
|---|---|---|
| UI | **Inter** (400/500/600) | Editor panels at 12–13 px, body 14–16 px |
| Display | **Bricolage Grotesque** (600/800) | Landing hero, Gallery header, empty-state titles |
| Mono | **JetBrains Mono** | Keyboard shortcut chips, numeric inputs in the properties panel |

Type scale (px): 12 · 13 · 14 · 16 · 18 · 22 · 28 · 36 · 48 · 64. Numbers in the properties panel use tabular figures.

### Shape, depth, motion
- Radius: 6 (inputs, chips) · 10 (buttons, cards) · 16 (panels, dialogs) · 24 (hero cards).
- Spacing: 4-pt scale (4, 8, 12, 16, 24, 32, 48, 64).
- Shadows: soft and low in light theme; in dark theme use borders + subtle inner highlight instead of heavy shadows.
- Motion: 120 ms (hover/press), 200 ms (panels, popovers), 320 ms (page-level); easing `cubic-bezier(0.2, 0.8, 0.2, 1)`. Respect `prefers-reduced-motion` (fade only).
- Icons: 20 px line icons, 1.5 px stroke, rounded joins, consistent family.

---

## 3. Information architecture

```
Public ─────────────────────────────────────────────────────────
  /                 Landing
  /templates        Template Gallery
  /templates/[id]   Template Detail
  /u/[handle]       Creator Profile
  /s/[token]        Shared Design View
  /signin           Sign in / Sign up

App (guest or signed in) ───────────────────────────────────────
  /home             Dashboard
  /designs          My Designs
  /edit/[id]        Editor

App (signed in) ────────────────────────────────────────────────
  /onboarding       Onboarding
  /media            Media Library
  /author/[id]      Author Mode
  /publish/[id]     Publish Flow
  /settings         Settings

Admin ──────────────────────────────────────────────────────────
  /admin/moderation Moderation
```

### Global navigation
- **Public header:** logo · Templates · (search field on Gallery) · Sign in · primary button "Start designing".
- **App shell (Dashboard, My Designs, Media, Settings):** left sidebar (logo; Home; Designs; Media; Templates; divider; "New design" primary button; bottom: profile avatar menu with Settings, Profile, Theme, Sign out). Collapses to a bottom tab bar under 768 px.
- **Editor & Author Mode:** full-screen, no app shell; own top bar (see §6.12).
- **Guest indicator:** a slim, friendly banner in the app shell — "You're designing as a guest. Your work is saved on this device. **Save to cloud →**"

---

## 4. Breakpoints & layout
| Name | Width | Notes |
|---|---|---|
| Mobile | 360–767 | Public pages, Dashboard, Designs, Media, Settings, Profile, Shared View fully usable. Editor shows the "bigger screen" state (§6.12 states). |
| Tablet | 768–1023 | Same as mobile but with 2–3 column grids |
| Desktop | 1024–1439 | Editor enabled |
| Wide | ≥ 1440 | Editor panels get more breathing room; gallery 5–6 columns |

Content max-width on marketing pages: 1200 px. 12-column grid, 24 px gutters (16 on mobile).

---

## 5. Component sheet (please design these as a system)

Button (primary / secondary / ghost / danger; sm/md/lg; loading; icon-only) · Input, Textarea, Search field · Select, Combobox (font picker with live font previews) · **Slider** (with numeric input + double-click-to-reset) · **ColorPicker** (saturation/value square, hue strip, hex input, document colours, eyedropper) · SegmentedControl · Toggle · Checkbox · Tabs · Popover · Tooltip (with shortcut chip) · Menu & ContextMenu (with shortcut hints) · Dialog · Sheet (bottom on mobile) · Toast (success/error/undo action) · Stepper (Publish flow) · Badge (Featured, Author, Hidden, Placeholder, Locked) · Avatar · Skeleton · EmptyState · DropZone (idle / drag-over / uploading / error) · **Template card** (thumbnail, format chip, title, author, uses) · **Design card** (thumbnail, title, edited time, menu) · **Layer row** (thumbnail, name, lock icon, visibility eye, drag handle, nested indent) · **Keyboard shortcut chip** · Progress (bar + ring) · Pagination "Load more" / infinite-scroll sentinel.

Every interactive component needs: default, hover, pressed, focus-visible, disabled, and (where relevant) loading and error states, in both themes.

---

## 6. Pages

Each page lists **purpose → layout → content → key interactions → states**.

### 6.1 Landing — `/`
**Purpose:** show, don't tell. Make a visitor *try it* within 5 seconds.
**Layout:**
```
[Header]
[Hero: left = headline + subcopy + CTA | right = LIVE MINI-EDITOR]
[Logo strip / "Made with VASH" marquee of real templates]
[3 feature bands: Drop photos → Frames adapt | Filters on the GPU | Publish templates]
[Template carousel by format]
[How it works: 1 Pick · 2 Drop · 3 Export]
[Creator callout: "Design templates others use" → Author Mode]
[Final CTA band]
[Footer]
```
**Content:** Headline idea: **"Your photos. Any template. Done in a minute."** Subcopy: "Pick a template, drop in your pictures, export. No sign-up needed."
**Key interaction — live mini-editor:** a real, small canvas with a sample Instagram-post template (3 photo frames). Visitors can drag their own photo from the desktop onto a frame (or click "Try with sample photos"), then flip through 3 filter chips. A floating hint: "Drop a photo here ↓". This is the signature moment — make it feel magical.
**States:** mini-editor loading skeleton; reduced-motion version with static preview.

### 6.2 Template Gallery — `/templates`
**Purpose:** find a template fast.
**Layout:** sticky header with a large search field; below it a row of **format chips** (All · Instagram post · Story · YouTube thumbnail · Poster · Invitation) and **category chips** (Birthday · Business · Food · Travel · Quotes · Events · Sale · Minimal); sort dropdown (Popular · New · Featured). Main area: **masonry grid** of Template cards (true aspect ratios — stories are tall, thumbnails are wide), infinite scroll.
**Card hover:** slight lift, "Use template" button appears, format chip + uses count visible.
**States:** skeleton masonry; no results ("No templates match 'wedding neon'. Try a broader search." + clear filters); end of list ("You've seen them all — why not make one?" → Author Mode).

### 6.3 Template Detail — `/templates/[id]`
**Layout:** two columns — left: large preview on a soft pasteboard background (click to zoom); right: title, author (avatar + handle → profile), format + size, category & tags, uses count, **"Use this template"** primary button, secondary "Share", overflow "Report". Below: "More from @author" row and "Similar templates" row.
**States:** hidden template (for its author only: banner "This template is hidden by moderators"); not found.
**Interaction:** "Use this template" → Editor opens with the copy; if the template has placeholders, the editor greets with "Drop your photos onto the highlighted frames".

### 6.4 Shared Design View — `/s/[token]`
**Purpose:** view someone's design read-only and remix it.
**Layout:** minimal header (logo, "Made with VASH"); centred design on pasteboard; below: title, owner name, "Remix this design" primary button, "Download PNG" secondary (if owner allowed), and a small "Create your own →" link.
**States:** link revoked ("This link has been turned off by its owner"); remix requires sign-in → sign-in page with return.

### 6.5 Creator Profile — `/u/[handle]`
**Layout:** header band with avatar, display name, @handle, joined date, stats (templates published, total uses); tabs: **Templates** (masonry, same card as gallery) · **Featured** (if any). Owner sees an "Edit profile" button → Settings.
**States:** no templates yet ("@meera hasn't published any templates yet"); user not found.

### 6.6 Sign in / Sign up — `/signin`
**Layout:** split screen — left: form card; right: rotating collage of templates (hidden on mobile).
**Content:** "Continue with Google" button; divider "or"; email field + "Email me a sign-in link". After submit: "Check your inbox — we sent a link to riya@…. It expires in 10 minutes." with "Resend" (cooldown timer) and "Use a different email".
**Guest note:** "Designs you made as a guest will move into your account."
**States:** invalid email; rate-limited ("Too many requests — try again in 12 minutes"); link expired (arriving from email).

### 6.7 Onboarding — `/onboarding`
**Purpose:** 30 seconds, then out of the way.
**Steps (single page, 2 short steps with progress dots):**
1. **Pick your handle & name** — handle field with live availability check (✓ available / ✕ taken / rules: 3–20 chars, lowercase letters, numbers, underscore).
2. **What will you design?** — selectable tiles with mini illustrations (Social posts · Stories · Business promos · Events & invites · YouTube thumbnails · Templates for others). Multi-select.
Then "Take me to VASH" → Dashboard with personalised recommendations. Include a "Skip" link on step 2.

### 6.8 Settings — `/settings`
**Layout:** left sub-nav (Profile · Account · Appearance · Keyboard shortcuts · Privacy & data), right content.
- **Profile:** avatar, display name, handle (with warning that links change), interests.
- **Account:** email (read-only), connected Google account, sign out of all devices.
- **Appearance:** theme (System / Light / Dark) with previews.
- **Keyboard shortcuts:** searchable reference table (not editable in v1).
- **Privacy & data:** storage used (bar: "312 MB of 500 MB"), **Download my data** (JSON export), **Delete account** (danger zone: type your handle to confirm; explains that designs, photos and published templates are deleted).

### 6.9 Dashboard — `/home`
**Layout (app shell):**
- Greeting ("Good evening, Riya") + big **"Create a design"** row: size preset cards (Instagram post 1080×1080 · Story 1080×1920 · YouTube thumbnail · Poster · Invitation · Custom size…).
- **Continue editing:** horizontal row of the 6 most recent designs.
- **Recommended for you:** template row based on onboarding interests.
- **Your templates** (if the user is an author): drafts and published, with uses count.
**States:** brand-new user (no designs — friendly empty state with 3 starter templates); guest (banner + same layout).

### 6.10 My Designs — `/designs`
**Layout:** header with title, search, sort (Last edited · Name · Created), view toggle (grid/list), "New design" button. Left: folders list ("All designs", "Templates (drafts)", user folders, "+ New folder"). Main: grid of Design cards or list rows (thumbnail, name, format, edited, folder).
**Interactions:** multi-select (checkbox on hover, Shift-click range) → bulk bar (Move to folder, Duplicate, Delete); inline rename; drag cards onto folders; card menu (Open, Rename, Duplicate, Move, Share link, Delete).
**States:** empty ("No designs yet — start from a template"), empty folder, search no-results, delete confirmation with **Undo toast**.

### 6.11 Media Library — `/media`
**Layout:** header with storage meter and "Upload" button; full-width **DropZone** at top when dragging files anywhere on the page; justified photo grid (rows of equal height, varying widths) with dates as section headers.
**Interactions:** multi-upload with per-file progress rings; select to delete; click to preview (lightbox with dimensions, size, "Used in 3 designs"); drag a photo from here into an open editor tab isn't needed — the editor has its own Photos panel.
**States:** empty ("Your uploads live here"), uploading, rejected file ("HEIC isn't supported yet — export as JPG or PNG"), quota nearly full (warning colour), quota full (blocked with explanation).

### 6.12 Editor — `/edit/[id]` ★ the most important screen
**Layout (desktop ≥ 1024):**
```
┌───────────────────────────────────────────────────────────────────────────┐
│ TOP BAR: logo · design title (editable) · saved status · ↶ ↷ · zoom ▾ ·    │
│          Share · Export ▾ (primary)                                        │
├────┬──────────────┬──────────────────────────────────────┬────────────────┤
│RAIL│ FLYOUT PANEL │                                      │ RIGHT PANEL    │
│    │ (320 px,     │            CANVAS AREA               │ (300 px)       │
│ ▣  │ collapsible) │     pasteboard + artboard centred    │ tabs:          │
│ ◫  │              │                                      │ Properties |   │
│ T  │ e.g. Photos: │   floating CONTEXT TOOLBAR above the │ Layers         │
│ ✦  │ upload btn + │   current selection                  │                │
│ ◯  │ photo grid   │                                      │                │
│ ⤒  │              │                                      │                │
├────┴──────────────┴──────────────────────────────────────┴────────────────┤
│ BOTTOM BAR (small): zoom slider · fit · 100% · canvas size · shortcuts ?  │
└───────────────────────────────────────────────────────────────────────────┘
```
**Left rail tabs → flyout content:**
- **Templates** — mini gallery filtered to this format; clicking asks "Replace current design?"
- **Photos** — Upload button + the user's media grid (guest: device photos only); drag onto frames.
- **Text** — "Add heading / subheading / body" presets + font pairing presets.
- **Stickers** — categorized grid (Arrows, Shapes, Badges, Doodles, Emoji-style).
- **Shapes & Frames** — rectangles, circles, arches, blobs, polaroid, film strip frames.
- **Filters** — only enabled when a photo frame is selected; preset thumbnails *rendered with the user's actual photo* (Original, Warm, Cool, Vintage, Mono, Fade, Vivid, Noir), then an "Adjust" section of sliders (Brightness, Contrast, Saturation, Warmth, Tint, Highlights, Shadows, Vignette, Grain, Blur, Sharpen) with reset per slider and "Reset all".

**Right panel — Properties (contextual):**
- *Nothing selected:* artboard size, background (colour picker / photo), document colours.
- *Frame:* photo (Replace, Remove, Fit: Cover/Contain), position/size/rotation numeric fields, corner radius, opacity, filters shortcut, lock state.
- *Text:* font combobox (live previews), weight, size, colour, alignment, line height, letter spacing, "Shrink to fit" toggle.
- *Shape/Sticker:* fill, stroke, opacity, transform fields.
- *Multiple:* align & distribute buttons, group.

**Right panel — Layers:** tree of layers with thumbnails, drag to reorder/nest, eye (visibility), lock icon (free / content-only / locked — shows a small lock badge), rename on double-click. Selection is mirrored between canvas and list.

**Canvas interactions to visualise:**
- Selection box with 8 resize handles + rotation handle; **pink snapping guides** with distance labels.
- **Photo drop:** while dragging a photo, the frame under the cursor glows (primary colour inset border + "Drop to place" label); other placeholder frames pulse softly.
- **Placeholder frame (empty):** subtle checker/diagonal pattern, image icon, "Drop a photo" label.
- **Pan inside frame** (double-click a frame): the full photo appears at 30 % opacity outside the frame boundary; drag to reposition, slider to zoom; "Done" button.
- **Swap photos:** dragging a photo from one frame onto another shows a swap icon.
- **Text editing:** caret and selection directly on canvas.
- **Content-only locked layer:** selecting shows a dashed outline without resize handles and a tooltip "Layout locked by template — you can still change the text/photo." Right-click → "Unlock layer".
- **Context toolbar** (floating above selection): for frames — Replace photo · Filters · Crop/position · ⋯; for text — font · size · colour · bold · align · ⋯.
- Right-click **context menu** with shortcuts (Copy ⌘C, Paste ⌘V, Duplicate ⌘D, Bring forward ⌘], Send backward ⌘[, Lock, Delete ⌫).

**Export ▾ popover:** format PNG; size 1× / 2× / 3× with resulting pixel dimensions; transparent background toggle; "Download" button; progress state; success toast.

**Top bar saved status:** "Saved", "Saving…", "Offline — saved on this device", "Couldn't save — retry".

**States:** loading (skeleton panels + artboard shimmer), **"This design changed in another tab"** conflict dialog (Reload their version · Keep mine as a copy), missing photo (frame shows broken-image placeholder + "Photo unavailable"), WebGL unavailable notice (filters disabled banner), **screen too small** (< 1024 px: illustration + "VASH's editor needs a bigger screen. Your design is saved — open it on a laptop." + Export PNG + Copy link), guest banner ("Save to cloud").

### 6.13 Author Mode — `/author/[id]`
The Editor, plus unmistakable author affordances:
- **Orange top banner/strip:** "Author Mode — you're editing a template" with **Preview as user** toggle and **Publish** primary button.
- **Template panel** (extra right-panel tab "Template"): title, format, category, tags input, description.
- **Per-layer controls** in Properties: Lock level segmented control (Free · Content only · Locked) with explanations; for frames: "Placeholder" toggle; for text: "Max characters" and "Shrink to fit".
- **Layers list** shows lock badges and a placeholder badge on frames.
- **Pre-save checklist popover** (✓/✕ list): "At least one placeholder or editable text", "No empty non-placeholder frames", "Fonts from the allowed list", "Under 150 layers".
- **Preview as user** mode: orange strip turns into "Previewing as a user — Exit preview".

### 6.14 Publish Flow — `/publish/[designId]`
**Layout:** full-page 5-step **Stepper** (left: live preview of the template; right: step content; bottom: Back / Continue).
1. **Details** — title, category (select), tags (chips input, max 10), description (280 chars).
2. **Privacy check** — list of every frame containing *your* photo, each row: thumbnail · frame name · choice [Replace with placeholder (default) | Keep photo]; choosing Keep reveals a required checkbox "I own this image and allow others to reuse it." Plus a **PII warnings** card: "We found a phone number in 'Contact text' — +91 98••• ••210. Publish anyway?" with a jump-to-layer link.
3. **Thumbnail** — auto-generated preview (re-render button).
4. **Preview as user** — interactive preview of the published template with placeholders.
5. **Publish** — summary + "Publish to gallery" button → success screen with confetti (reduced-motion: none), link to the template page, "Copy link", "Share on…".
**States:** validation errors per step; rate-limited ("You can publish 5 templates a day"); server rejection with the exact issue.

### 6.15 Moderation — `/admin/moderation`
**Layout:** dense, keyboard-first admin table. Tabs: Open reports · Resolved · Featured · Hidden. Rows: template thumbnail · title · author · report count · top reason · first reported · status. Right side: **detail drawer** (large preview, all reports with reasons and notes, author history) with actions **Hide**, **Restore**, **Feature/Unfeature**, **Resolve** (keyboard: H, R, F, E; J/K to move between rows).
**States:** empty queue ("Inbox zero 🎉"), action confirmation toasts with Undo, audit trail list in the drawer.

---

## 7. Cross-cutting states & microcopy
- **Voice:** friendly, short, specific. Verbs on buttons ("Use template", "Drop photos", "Publish"). Never blame the user. Errors say what happened and what to do next.
- **Empty states:** every list has one — illustration (simple, on-brand shapes), one-line title, one-line help, one action.
- **Loading:** skeletons that match the final layout; no spinners longer than 300 ms without a skeleton.
- **Toasts:** bottom-centre, auto-dismiss 5 s, include **Undo** for destructive actions.
- **404 / 500 pages:** playful — a "misaligned layers" illustration; links to Home and Templates.

## 8. Accessibility requirements
- WCAG 2.2 AA contrast for all text and essential icons (including muted text).
- Visible focus ring (2 px `--primary` + 2 px offset) on every interactive element.
- Everything reachable by keyboard; the Layers list is the keyboard/screen-reader way to select canvas objects.
- Hit targets ≥ 24×24 px (≥ 44×44 on touch layouts).
- Don't rely on colour alone (lock/placeholder badges have icons + labels).

## 9. What to deliver
1. Component sheet (§5) in light + dark.
2. All 15 pages (§6) at Desktop (1440) — plus Mobile (390) for: Landing, Gallery, Template Detail, Shared View, Profile, Sign in, Onboarding, Dashboard, My Designs, Media, Settings, and the Editor "screen too small" state.
3. Editor detail frames: photo-drop hover, pan-inside-frame, text editing, snapping guides, content-only locked selection, filters panel with a selected photo, export popover, conflict dialog.
4. Author Mode frames: banner, template panel, lock controls, pre-save checklist, preview-as-user.
5. Publish Flow: all 5 steps + success + a PII warning example.

## 10. Out of scope (don't design)
Video/animation timelines, multi-page carousels, real-time collaboration cursors, payments/pricing pages, AI generation features, a phone-sized editor.
