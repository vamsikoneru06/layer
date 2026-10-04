import { eq, sql } from "drizzle-orm";
import { templates, user } from "../db/schema";
import type { Db } from "../db/types";

export interface PublicProfileRow {
  id: string;
  handle: string | null;
  name: string;
  image: string | null;
  createdAt: Date;
  templates: number;
  uses: number;
}

/** Counts cover published templates only, like everything else the public sees. */
export async function getPublicProfile(db: Db, handle: string): Promise<PublicProfileRow | undefined> {
  const published = sql`${templates.authorId} = ${user.id} and ${templates.status} = 'published'`;
  const [row] = await db
    .select({
      id: user.id,
      handle: user.handle,
      name: user.name,
      image: user.image,
      createdAt: user.createdAt,
      templates: sql<number>`(select count(*)::int from ${templates} where ${published})`,
      uses: sql<number>`(select coalesce(sum(${templates.usesCount}), 0)::int from ${templates} where ${published})`,
    })
    .from(user)
    .where(eq(user.handle, handle));
  return row;
}
