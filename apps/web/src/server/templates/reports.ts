import { isForeignKeyViolation, isUniqueViolation } from "../db/errors";
import { reports } from "../db/schema";
import type { Db } from "../db/types";
import type { CurrentUser } from "../deps";
import { conflict, notFound, unprocessable } from "../http/problem";
import { getTemplateCard } from "./repository";

export type ReportReason = (typeof reports.$inferInsert)["reason"];

/** Only published templates can be reported; the unique (template, reporter) key dedupes. */
export async function reportTemplate(db: Db, reporter: CurrentUser, templateId: string, input: { reason: ReportReason; note: string }, now: Date) {
  const card = await getTemplateCard(db, templateId);
  if (card?.status !== "published") throw notFound();
  if (card.authorId === reporter.id) throw unprocessable("You can't report your own template.");
  try {
    const [row] = await db.insert(reports).values({ templateId, reporterId: reporter.id, reason: input.reason, note: input.note, createdAt: now }).returning();
    return row!;
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("You've already reported this template.");
    if (isForeignKeyViolation(err)) throw notFound();
    throw err;
  }
}
