import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));

/** Migrates and seeds the end-to-end database (both are idempotent), so templates and sample photos exist. */
export default function globalSetup(): void {
  const env = { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL };
  for (const script of ["db:migrate", "db:seed"]) execSync(`corepack pnpm run ${script}`, { cwd: web, env, stdio: "inherit" });
}
