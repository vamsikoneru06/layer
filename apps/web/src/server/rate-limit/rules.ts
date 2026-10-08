import type { RateLimitRule } from "./limiter";

/** Spec §9.6. Keys are built by the caller (per user, per IP, per hashed email). */
export const RATE_LIMITS = {
  magicLinkPerEmail: { windowSeconds: 3_600, max: 5 },
  magicLinkPerIp: { windowSeconds: 3_600, max: 20 },
  uploadUrl: { windowSeconds: 3_600, max: 60 },
  designSave: { windowSeconds: 60, max: 120 },
  shareCreate: { windowSeconds: 3_600, max: 30 },
  sharedView: { windowSeconds: 60, max: 120 },
  publish: { windowSeconds: 86_400, max: 5 },
  report: { windowSeconds: 86_400, max: 20 },
  publicRead: { windowSeconds: 60, max: 300 },
  // Not in §9.6: design create and duplicate share this bucket; export streams every design the user owns.
  designCreate: { windowSeconds: 3_600, max: 100 },
  accountExport: { windowSeconds: 3_600, max: 5 },
  // Every other signed-in write (rename, move, delete, folders, profile) shares one per-user budget.
  userWrite: { windowSeconds: 60, max: 300 },
  // Browser error reports relayed to Sentry; keeps one visitor from spending the free monthly quota.
  errorReport: { windowSeconds: 60, max: 30 },
  // The /report-a-bug form: per account, or per IP for guests.
  bugReport: { windowSeconds: 3_600, max: 10 },
} as const satisfies Record<string, RateLimitRule>;
