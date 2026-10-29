import { CURRENT_SCHEMA_VERSION } from "./constants";

/**
 * A migration upgrades a raw document from `from` to `from + 1`.
 * Migrations run on untrusted input, before validation, so they must be defensive.
 */
export interface Migration {
  from: number;
  migrate(doc: Record<string, unknown>): Record<string, unknown>;
}

/** Version 1 filed templates by topic; version 2 by job. The closest job for each old topic. */
export const V1_CATEGORIES: Readonly<Record<string, string>> = {
  birthday: "celebrations",
  business: "announcements",
  food: "menus",
  travel: "photo-posts",
  quotes: "quotes-tips",
  events: "events",
  sale: "sales",
  minimal: "photo-posts",
};

/** Ordered list of migrations. */
export const MIGRATIONS: readonly Migration[] = [
  {
    from: 1,
    migrate(doc) {
      const meta = doc.meta;
      if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return doc;
      const old = (meta as Record<string, unknown>).category;
      if (typeof old !== "string") return doc;
      const category = Object.hasOwn(V1_CATEGORIES, old) ? V1_CATEGORIES[old] : null;
      return { ...doc, meta: { ...meta, category } };
    },
  },
];

export type MigrateResult =
  | { ok: true; doc: unknown; migrated: boolean }
  | { ok: false; error: string };

export function migrateDoc(
  input: unknown,
  migrations: readonly Migration[] = MIGRATIONS,
  target: number = CURRENT_SCHEMA_VERSION,
): MigrateResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "document must be an object" };
  }
  let doc = input as Record<string, unknown>;
  const start = doc.schemaVersion;
  if (typeof start !== "number" || !Number.isInteger(start) || start < 1) {
    return { ok: false, error: "schemaVersion must be a positive integer" };
  }
  if (start > target) {
    return { ok: false, error: `schemaVersion ${start} is newer than supported version ${target}` };
  }

  let version = start;
  while (version < target) {
    const step = migrations.find((m) => m.from === version);
    if (!step) return { ok: false, error: `no migration from schemaVersion ${version}` };
    doc = { ...step.migrate(doc), schemaVersion: version + 1 };
    version += 1;
  }
  return { ok: true, doc, migrated: version !== start };
}
