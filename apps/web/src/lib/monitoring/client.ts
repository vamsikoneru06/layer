/** Same-origin endpoint that relays browser reports to Sentry, so the CSP needs no third-party host. */
export const SENTRY_TUNNEL = "/api/monitoring";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

/** Loaded on demand, so pages ship no Sentry code unless a DSN is configured. */
export function loadSentry() {
  return dsn ? import("@sentry/nextjs") : Promise.resolve(null);
}

/** For error boundaries: reports a caught render error. A no-op without a DSN. */
export function reportClientError(error: unknown): void {
  void loadSentry().then((Sentry) => Sentry?.captureException(error));
}
