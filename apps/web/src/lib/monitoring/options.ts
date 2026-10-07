import { scrubBreadcrumb, scrubEvent } from "./scrub";

/**
 * Options shared by the browser and the server. Errors only: no tracing (no `tracesSampleRate`), no session replay,
 * no default PII, and every event and breadcrumb passes through the scrubber.
 */
export function baseSentryOptions(dsn: string, environment: string | undefined, release: string | undefined) {
  return {
    dsn,
    environment: environment ?? "development",
    ...(release ? { release } : {}),
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
