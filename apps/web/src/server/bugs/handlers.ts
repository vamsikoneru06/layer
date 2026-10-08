import { z } from "zod";
import { BUG_REPORT_LIMITS, reportPage } from "@/lib/bug-reports";
import type { Deps } from "../deps";
import { readJson, readQuery } from "../http/body";
import { decodeCursor, pageQuery, toPage } from "../http/cursor";
import { endpoint } from "../http/endpoint";
import { parseId } from "../http/ids";
import { RATE_LIMITS } from "../rate-limit/rules";
import { createBugReport, listBugReports, resolveBugReport, type BugReportListRow } from "./service";

/** Per account when signed in, per IP for guests. */
const sendLimit = { name: "bugReport", rule: RATE_LIMITS.bugReport, by: "user" } as const;
const writeLimit = { name: "userWrite", rule: RATE_LIMITS.userWrite, by: "user" } as const;

const BugReportBody = z
  .object({
    summary: z.string().trim().min(1, "Describe what happened.").max(BUG_REPORT_LIMITS.summaryChars),
    expected: z.string().trim().max(BUG_REPORT_LIMITS.expectedChars).default(""),
    steps: z.string().trim().max(BUG_REPORT_LIMITS.stepsChars).default(""),
    page: z.string().max(BUG_REPORT_LIMITS.pageChars).default("").transform(reportPage),
  })
  .strict();
const ListQuery = pageQuery.extend({ status: z.enum(["open", "fixed", "dismissed"]).default("open") });
const ResolveBody = z.object({ status: z.enum(["fixed", "dismissed"]) }).strict();

const bugReportJson = (r: BugReportListRow) => ({
  id: r.id,
  summary: r.summary,
  expected: r.expected,
  steps: r.steps,
  page: r.page,
  userAgent: r.userAgent,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  resolvedAt: r.resolvedAt?.toISOString() ?? null,
  reporterEmail: r.reporterEmail,
});

export function bugReportHandlers(deps: Deps) {
  return {
    create: endpoint(deps, { auth: "optional", rateLimit: sendLimit }, async ({ req, user }) => {
      const body = await readJson(req, BugReportBody);
      const userAgent = (req.headers.get("user-agent") ?? "").slice(0, BUG_REPORT_LIMITS.userAgentChars);
      const row = await createBugReport(deps.db, user, body, userAgent, deps.now());
      return Response.json({ id: row.id, status: row.status, createdAt: row.createdAt.toISOString() }, { status: 201 });
    }),

    list: endpoint(deps, { auth: "admin" }, async ({ req }) => {
      const q = readQuery(req, ListQuery);
      const rows = await listBugReports(deps.db, { status: q.status, after: q.cursor ? decodeCursor(q.cursor) : undefined, limit: q.limit });
      return Response.json(toPage(rows, q.limit, (r) => ({ at: r.createdAt.toISOString(), id: r.id }), bugReportJson));
    }),

    resolve: endpoint(deps, { auth: "admin", rateLimit: writeLimit }, async ({ req, user, params }) => {
      const id = parseId(params.id);
      const { status } = await readJson(req, ResolveBody);
      const row = await resolveBugReport(deps.db, user, id, status, deps.now());
      return Response.json({ id: row.id, status: row.status, resolvedAt: row.resolvedAt?.toISOString() ?? null });
    }),
  };
}
