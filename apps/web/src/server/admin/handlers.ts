import { z } from "zod";
import type { Deps } from "../deps";
import { readJson, readQuery } from "../http/body";
import { decodeCursor, pageQuery, toPage } from "../http/cursor";
import { endpoint } from "../http/endpoint";
import { parseId } from "../http/ids";
import { notFound } from "../http/problem";
import { RATE_LIMITS } from "../rate-limit/rules";
import { getTemplateCard, listTemplatesByStatus } from "../templates/repository";
import { toTemplateJson } from "../templates/view";
import { listReports, type ReportListRow } from "./repository";
import { moderateTemplate, resolveReport } from "./service";

const writeLimit = { name: "userWrite", rule: RATE_LIMITS.userWrite, by: "user" } as const;
const ReportsQuery = pageQuery.extend({ status: z.enum(["open", "actioned", "dismissed"]).default("open") });
const TemplatesQuery = pageQuery.extend({ status: z.enum(["published", "hidden"]).default("hidden"), featured: z.enum(["true"]).optional() });
const ResolveBody = z.object({ status: z.enum(["actioned", "dismissed"]) }).strict();
const ModerateBody = z.object({ action: z.enum(["hide", "restore", "feature", "unfeature"]) }).strict();

const reportJson = (r: ReportListRow) => ({
  id: r.id,
  reason: r.reason,
  note: r.note,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  resolvedAt: r.resolvedAt?.toISOString() ?? null,
  reporterHandle: r.reporterHandle,
  template: { id: r.templateId, title: r.templateTitle, status: r.templateStatus, featured: r.templateFeatured, authorHandle: r.authorHandle },
});

export function adminHandlers(deps: Deps) {
  return {
    reports: endpoint(deps, { auth: "admin" }, async ({ req }) => {
      const q = readQuery(req, ReportsQuery);
      const rows = await listReports(deps.db, { status: q.status, after: q.cursor ? decodeCursor(q.cursor) : undefined, limit: q.limit });
      return Response.json(toPage(rows, q.limit, (r) => ({ at: r.createdAt.toISOString(), id: r.id }), reportJson));
    }),

    resolveReport: endpoint(deps, { auth: "admin", rateLimit: writeLimit }, async ({ req, user, params }) => {
      const id = parseId(params.id);
      const { status } = await readJson(req, ResolveBody);
      const row = await resolveReport(deps.db, user, id, status, deps.now());
      return Response.json({ id: row.id, status: row.status, resolvedAt: row.resolvedAt?.toISOString() ?? null });
    }),

    moderate: endpoint(deps, { auth: "admin", rateLimit: writeLimit }, async ({ req, user, params }) => {
      const id = parseId(params.id);
      const { action } = await readJson(req, ModerateBody);
      await moderateTemplate(deps.db, user, id, action, deps.now());
      const card = await getTemplateCard(deps.db, id);
      if (!card) throw notFound();
      return Response.json(toTemplateJson(card));
    }),

    templates: endpoint(deps, { auth: "admin" }, async ({ req }) => {
      const q = readQuery(req, TemplatesQuery);
      const rows = await listTemplatesByStatus(deps.db, { status: q.status, featured: q.featured === "true", after: q.cursor ? decodeCursor(q.cursor) : undefined, limit: q.limit });
      return Response.json(toPage(rows, q.limit, (r) => ({ at: r.createdAt.toISOString(), id: r.id }), toTemplateJson));
    }),
  };
}
