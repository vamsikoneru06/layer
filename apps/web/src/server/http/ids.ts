import { notFound } from "./problem";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);

/** A path id that isn't a UUID can't match any row; answer 404 instead of letting Postgres fail the cast. */
export function parseId(value: string | undefined): string {
  if (value === undefined || !isUuid(value)) throw notFound();
  return value.toLowerCase();
}
