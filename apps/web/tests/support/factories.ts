import { randomUUID } from "node:crypto";
import { assets, folders, user } from "@/server/db/schema";
import type { Db } from "@/server/db/types";

export async function createUser(db: Db, overrides: Partial<typeof user.$inferInsert> = {}) {
  const id = overrides.id ?? `u_${randomUUID()}`;
  const [row] = await db
    .insert(user)
    .values({ id, name: "Test User", email: `${id}@example.test`, emailVerified: true, ...overrides })
    .returning();
  if (!row) throw new Error("user insert returned nothing");
  return row;
}

export async function createFolder(db: Db, ownerId: string, name = "Birthdays") {
  const [row] = await db.insert(folders).values({ ownerId, name }).returning();
  if (!row) throw new Error("folder insert returned nothing");
  return row;
}

export async function createAsset(db: Db, overrides: Partial<typeof assets.$inferInsert> & { ownerId: string | null }) {
  const id = overrides.id ?? randomUUID();
  const [row] = await db
    .insert(assets)
    .values({
      id,
      kind: "photo",
      visibility: "private",
      status: "ready",
      storageKey: `u/${overrides.ownerId ?? "system"}/${id}`,
      mime: "image/jpeg",
      bytes: 1_000,
      width: 1200,
      height: 900,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("asset insert returned nothing");
  return row;
}
