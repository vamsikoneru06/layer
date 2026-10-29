import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadConfig } = await import("./server/config");
    const config = loadConfig(process.env);
    if (config.sentryDsn) {
      const { initServerSentry } = await import("./server/monitoring/sentry");
      initServerSentry(config.sentryDsn);
    }
  }
}

/** Errors that escape a page or route (API handlers catch their own and report through the logger). */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
