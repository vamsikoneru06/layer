import { and, eq } from "drizzle-orm";
import { auditLog, reports, templates } from "../db/schema";
import type { Db } from "../db/types";
import type { CurrentUser } from "../deps";
import { conflict, notFound } from "../http/problem";

export type ModerationAction = "hide" | "restore" | "feature" | "unfeature";

const CHANGES: Record<ModerationAction, { status?: "published" | "hidden"; featured?: boolean }> = {
  hide: { status: "hidden", featured: false },
  restore: { status: "published" },
  feature: { featured: true },
  unfeature: { featured: false },
};

/** Every admin action is written to audit_log in the same transaction as the change (spec §8.4). */
export async function resolveReport(db: Db, admin: CurrentUser, reportId: string, status: "actioned" | "dismissed", now: Date) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(reports)
      .set({ status, resolvedBy: admin.id, resolvedAt: now })
      .where(and(eq(reports.id, reportId), eq(reports.status, "open")))
      .returning();
    if (!row) {
      const [exists] = await tx.select({ id: reports.id }).from(reports).where(eq(reports.id, reportId));
      throw exists ? conflict("This report has already been resolved.") : notFound();
    }
    await tx.insert(auditLog).values({ actorId: admin.id, action: "report.resolve", targetType: "report", targetId: reportId, meta: { status, templateId: row.templateId }, createdAt: now });
    return row;
  });
}

/** Hiding also unfeatures the template and closes its open reports as actioned. */
export async function moderateTemplate(db: Db, admin: CurrentUser, templateId: string, action: ModerationAction, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [tpl] = await tx.select({ status: templates.status }).from(templates).where(eq(templates.id, templateId)).for("update");
    if (!tpl) throw notFound();
    if (action === "feature" && tpl.status === "hidden") throw conflict("Restore this template before featuring it.");
    await tx.update(templates).set(CHANGES[action]).where(eq(templates.id, templateId));
    let reportsResolved = 0;
    if (action === "hide") {
      const closed = await tx
        .update(reports)
        .set({ status: "actioned", resolvedBy: admin.id, resolvedAt: now })
        .where(and(eq(reports.templateId, templateId), eq(reports.status, "open")))
        .returning({ id: reports.id });
      reportsResolved = closed.length;
    }
    await tx.insert(auditLog).values({ actorId: admin.id, action: `template.${action}`, targetType: "template", targetId: templateId, meta: { reportsResolved }, createdAt: now });
  });
}
