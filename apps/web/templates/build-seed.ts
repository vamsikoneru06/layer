import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { seedTemplates } from "./seed-templates";

const dir = new URL("./seed/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const file of readdirSync(dir)) if (file.endsWith(".json")) rmSync(new URL(file, dir));

const docs = seedTemplates();
for (const doc of docs) writeFileSync(new URL(`${doc.id}.json`, dir), `${JSON.stringify(doc, null, 2)}\n`);
console.log(`wrote ${docs.length} seed templates`);
