import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** Any Drizzle Postgres database or transaction (node-postgres at runtime, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
