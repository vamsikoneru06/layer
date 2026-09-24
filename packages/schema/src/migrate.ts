import { CURRENT_SCHEMA_VERSION } from "./constants";

/**
 * A migration upgrades a raw document from `from` to `from + 1`.
 * Migrations run on untrusted input, before validation, so they must be defensive.
 */
export interface Migration {
  from: number;
  migrate(doc: Record<string, unknown>): Record<string, unknown>;
}

/** Ordered list of migrations. Empty while the format is at version 1. */
export const MIGRATIONS: readonly Migration[] = [];

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
