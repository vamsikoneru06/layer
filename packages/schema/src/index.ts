export * from "./types";
export { CATEGORIES, CURRENT_SCHEMA_VERSION, FONT_FAMILIES, FORMAT_KEYS, FORMATS, LIMITS } from "./constants";
export { validatePathData } from "./path";
export { validateDoc, type ValidateOptions } from "./validate";
export { migrateDoc, MIGRATIONS, type Migration, type MigrateResult } from "./migrate";
export { createEmptyDoc, defaultFilters, type EmptyDocOptions } from "./factory";
export { lintTemplate, referencedAssetIds, scanForPii, scrubForPublish, type PiiFinding } from "./template";

import { migrateDoc } from "./migrate";
import { validateDoc, type ValidateOptions } from "./validate";
import type { ValidationResult } from "./types";

/** Migrate to the current schema version, then validate. The single entry point for untrusted documents. */
export function parseDoc(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const migrated = migrateDoc(input);
  if (!migrated.ok) return { ok: false, issues: [{ path: "schemaVersion", message: migrated.error }] };
  return validateDoc(migrated.doc, options);
}
