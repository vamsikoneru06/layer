/** SQLSTATE of a Postgres error, looking through Drizzle's DrizzleQueryError wrapper. */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; current && depth < 3; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export const isUniqueViolation = (err: unknown): boolean => pgErrorCode(err) === "23505";

export const isForeignKeyViolation = (err: unknown): boolean => pgErrorCode(err) === "23503";
