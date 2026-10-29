import "server-only";
import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions } from "@/lib/monitoring/options";
import type { ErrorReporter } from "../logging";

export function initServerSentry(dsn: string): void {
  Sentry.init(baseSentryOptions(dsn, process.env.VERCEL_ENV ?? process.env.NODE_ENV, process.env.VERCEL_GIT_COMMIT_SHA));
}

/** The logger's error hook: each logged error becomes one Sentry issue event, tagged for finding its log line. */
export const reportError: ErrorReporter = (err, { event, requestId }) => {
  Sentry.captureException(err, { tags: { event, ...(requestId ? { requestId } : {}) } });
};

/**
 * Sentry cron monitor check-ins around a scheduled job, so a run that fails, hangs or never starts raises an alert.
 * `schedule` must match `vercel.json`.
 */
export function cronMonitor(slug: string, schedule: string) {
  return <T>(job: () => Promise<T>): Promise<T> =>
    Sentry.withMonitor(slug, job, {
      schedule: { type: "crontab", value: schedule },
      timezone: "Etc/UTC",
      checkinMargin: 60,
      maxRuntime: 15,
      failureIssueThreshold: 1,
      recoveryThreshold: 1,
    });
}
