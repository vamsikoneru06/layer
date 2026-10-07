import { loadSentry, SENTRY_TUNNEL } from "./lib/monitoring/client";
import { baseSentryOptions } from "./lib/monitoring/options";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  void loadSentry().then((Sentry) =>
    Sentry?.init({
      ...baseSentryOptions(dsn, process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV, process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA),
      tunnel: SENTRY_TUNNEL,
    }),
  );
}
