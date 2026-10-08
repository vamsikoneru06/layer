import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/server/db/schema";
import { grantAdmin } from "../src/server/admin/grant";

// Usage: DATABASE_URL=<direct Neon URL> pnpm admin:grant you@example.com  (the account must have signed in once)
const url = process.env.DATABASE_URL;
const email = process.argv[2];
if (!url || !email) {
  console.error("Usage: DATABASE_URL=... pnpm admin:grant <email of an existing account>");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });
try {
  const outcome = await grantAdmin(drizzle(pool, { schema }), email, new Date());
  const messages = { granted: "Done: that account is now an admin.", already: "That account is already an admin.", missing: "No account uses that email. Sign in once first." };
  console.log(messages[outcome]);
  if (outcome === "missing") process.exitCode = 1;
} finally {
  await pool.end();
}
