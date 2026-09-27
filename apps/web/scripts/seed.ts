import { readdirSync, readFileSync } from "node:fs";
import { parseDoc, type Doc } from "@vash/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/server/db/schema";
import { loadSeedTemplates } from "../src/server/templates/seed";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const dir = new URL("../templates/seed/", import.meta.url);
const docs: Doc[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((file) => {
    const parsed = parseDoc(JSON.parse(readFileSync(new URL(file, dir), "utf8")), { kind: "template" });
    if (!parsed.ok) throw new Error(`${file}: ${JSON.stringify(parsed.issues.slice(0, 5))}`);
    return parsed.doc;
  });

const pool = new Pool({ connectionString: url, max: 1 });
try {
  const r = await loadSeedTemplates(drizzle(pool, { schema }), docs, new Date());
  console.log(`seed templates: ${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged`);
} finally {
  await pool.end();
}
