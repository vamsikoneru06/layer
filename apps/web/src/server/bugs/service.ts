import { and, asc, desc, eq, sql } from "drizzle-orm";
import { auditLog, bugReports, user } from "../db/schema";
import type { Db } from "../db/types";
import type { CurrentUser } from "../deps";
import type { Cursor } from "../http/cursor";
import { conflict, notFound } from "../http/problem";

export type BugReportStatus = (typeof bugReports.$inferSelect)["status"];

export interface BugReportInput {
  summary: string;
  expected: string;
  steps: string;
  page: string;
}

export async function createBugReport(db: Db, reporter: CurrentUser | null, input: BugReportInput, userAgent: string, now: Date) {
  const [row] = await db
    .insert(bugReports)
    .values({ reporterId: reporter?.id ?? null, ...input, userAgent, createdAt: now })
    .returning();
  return row!;
}

/** Same order as template reports: the open queue reads oldest first, resolved lists newest first. */
export function listBugReports(db: Db, q: { status: BugReportStatus; after?: Cursor; limit: number }) {
  const oldestFirst = q.status === "open";
  const keyset = q.after
    ? oldestFirst
      ? sql`(${bugReports.createdAt}, ${bugReports.id}) > (${q.after.at}::timestamptz, ${q.after.id}::uuid)`
      : sql`(${bugReports.createdAt}, ${bugReports.id}) < (${q.after.at}::timestamptz, ${q.after.id}::uuid)`
    : undefined;
  return db
    .select({
      id: bugReports.id,
      summary: bugReports.summary,
      expected: bugReports.expected,
      steps: bugReports.steps,
      page: bugReports.page,
      userAgent: bugReports.userAgent,
      status: bugReports.status,
      createdAt: bugReports.createdAt,
      resolvedAt: bugReports.resolvedAt,
      reporterEmail: user.email,
    })
    .from(bugReports)
    .leftJoin(user, eq(user.id, bugReports.reporterId))
    .where(and(eq(bugReports.status, q.status), keyset))
    .orderBy(...(oldestFirst ? [asc(bugReports.createdAt), asc(bugReports.id)] : [desc(bugReports.createdAt), desc(bugReports.id)]))
    .limit(q.limit + 1);
}

export type BugReportListRow = Awaited<ReturnType<typeof listBugReports>>[number];

/** Written to audit_log in the same transaction, like every admin action (spec §8.4). */
export async function resolveBugReport(db: Db, admin: CurrentUser, id: string, status: "fixed" | "dismissed", now: Date) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(bugReports)
      .set({ status, resolvedBy: admin.id, resolvedAt: now })
      .where(and(eq(bugReports.id, id), eq(bugReports.status, "open")))
      .returning();
    if (!row) {
      const [exists] = await tx.select({ id: bugReports.id }).from(bugReports).where(eq(bugReports.id, id));
      throw exists ? conflict("This bug report has already been resolved.") : notFound();
    }
    await tx.insert(auditLog).values({ actorId: admin.id, action: "bug_report.resolve", targetType: "bug_report", targetId: id, meta: { status }, createdAt: now });
    return row;
  });
}
