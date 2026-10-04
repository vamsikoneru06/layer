import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { reports, templates, user } from "../db/schema";
import type { Db } from "../db/types";
import type { Cursor } from "../http/cursor";

export type ReportStatus = (typeof reports.$inferSelect)["status"];

const author = alias(user, "author");
const reporter = alias(user, "reporter");

/** The open queue reads oldest first (work it in order); resolved lists read newest first. */
export function listReports(db: Db, q: { status: ReportStatus; after?: Cursor; limit: number }) {
  const oldestFirst = q.status === "open";
  const keyset = q.after
    ? oldestFirst
      ? sql`(${reports.createdAt}, ${reports.id}) > (${q.after.at}::timestamptz, ${q.after.id}::uuid)`
      : sql`(${reports.createdAt}, ${reports.id}) < (${q.after.at}::timestamptz, ${q.after.id}::uuid)`
    : undefined;
  return db
    .select({
      id: reports.id,
      reason: reports.reason,
      note: reports.note,
      status: reports.status,
      createdAt: reports.createdAt,
      resolvedAt: reports.resolvedAt,
      reporterHandle: reporter.handle,
      templateId: templates.id,
      templateTitle: templates.title,
      templateStatus: templates.status,
      templateFeatured: templates.featured,
      authorHandle: author.handle,
    })
    .from(reports)
    .innerJoin(templates, eq(templates.id, reports.templateId))
    .innerJoin(reporter, eq(reporter.id, reports.reporterId))
    .leftJoin(author, eq(author.id, templates.authorId))
    .where(and(eq(reports.status, q.status), keyset))
    .orderBy(...(oldestFirst ? [asc(reports.createdAt), asc(reports.id)] : [desc(reports.createdAt), desc(reports.id)]))
    .limit(q.limit + 1);
}

export type ReportListRow = Awaited<ReturnType<typeof listReports>>[number];
