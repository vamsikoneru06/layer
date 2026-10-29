# Version history

S8 of `2026-10-07-canva-parity-roadmap.md`. Share links, view-only links and remix already exist (#25), so this
batch adds the missing half: earlier versions of a design that the owner can look at and restore.

## What people get

- **File > Version history** opens a side panel listing earlier versions of the design, newest first, each with its
  time ("Today, 14:05", "Yesterday, 09:12", "3 Oct, 18:40") and a small preview rendered in the browser from the
  version's document (the engine's renderer, no server images).
- Selecting a version shows a larger preview. **Restore this version** (with a confirm step) replaces the design's
  content with it as a new save. The content it replaces is kept as a newer version, so switching back is another
  restore. Nothing is lost by restoring. (The editor reloads after a restore, so Ctrl+Z does not undo it.)
- Designs kept in the browser (guest mode) show "Version history needs an account. Save to account to keep
  versions." with the existing Save to account button.

## When versions are kept

- On a save, the server keeps a snapshot of the document it is replacing when the newest kept version is more than
  10 minutes old, and always when the save comes from Ctrl+S or File > Save (an explicit save sends `checkpoint:
  true`). A restore keeps a snapshot of the content it replaces.
- At most 30 versions per design; the oldest are deleted when a new one is kept. Versions are deleted with the
  design (foreign key with cascade) and are included in account export and removed by account deletion.

## Data and security

- Table `design_versions` (id uuid, design_id uuid references designs on delete cascade, owner_id text references
  user on delete cascade, version integer, title text, doc jsonb, created_at). Index on (design_id, created_at desc).
- Migration `0010_design_versions.sql` (0009 is taken by open PR #50; renumber at merge time if the order changes),
  with a row-level security policy like `designs_owner` in 0007.
- Owner-scoped everywhere, with cross-user tests: another account's design id answers 404 for list, get and restore.
- API: `GET /api/designs/:id/versions` (id, version, title, createdAt; no documents), `GET
  /api/designs/:id/versions/:versionId` (document), `POST /api/designs/:id/versions/:versionId/restore` (expects the
  current design version for optimistic concurrency, answers 409 on a conflict like saves do). Rate limited like
  other signed-in reads and writes.
- Free-tier storage: snapshots are documents only (assets are referenced by id, never copied), and the 30-version
  cap bounds growth.

## Legal

- Privacy page: earlier versions of a design (up to 30) are kept so the owner can restore them, are deleted with the
  design or the account, and are included in the account export. Terms need no change.

## Testing

Repository and service tests (snapshot rules, cap and pruning, restore keeps a snapshot, concurrency), handler tests
with cross-user cases, account export and deletion include versions, panel helpers (time labels) tests; typecheck,
lint, all tests; a browser check with a signed-in test account on a local database this session owns (never write to
another session's database).
