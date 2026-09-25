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
} as const satisfies Record<string, RateLimitRule>;
