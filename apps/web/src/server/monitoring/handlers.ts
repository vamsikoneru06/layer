import type { Deps } from "../deps";
import { readText } from "../http/body";
import { clientIp, rateLimitSubject } from "../http/client-ip";
import { endpoint } from "../http/endpoint";
import { badRequest, HttpError, notFound } from "../http/problem";
import { consume } from "../rate-limit/limiter";
import { RATE_LIMITS } from "../rate-limit/rules";

/** Error envelopes are a few KB; anything bigger is not a report from our SDK. */
export const TUNNEL_BODY_LIMIT = 256 * 1024;
const UPSTREAM_TIMEOUT_MS = 5_000;
const PASSED_HEADERS = ["x-sentry-rate-limits", "retry-after"];

/** The DSN's public key, host and project: the parts that must match before anything is relayed. */
function dsnParts(dsn: string): { key: string; host: string; project: string } | null {
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\//, "");
    return u.protocol === "https:" && u.username && /^\d+$/.test(project) ? { key: u.username, host: u.host, project } : null;
  } catch {
    return null;
  }
}

/**
 * `POST /api/monitoring`: the browser SDK's tunnel. Reports reach Sentry through our own origin, so the CSP needs no
 * Sentry host and ad blockers don't drop them. Only envelopes addressed to our own project are relayed, and the client's
 * IP address is not passed on.
 */
export function monitoringHandlers(deps: Deps, forward: typeof fetch = fetch) {
  const ours = deps.config.sentryDsn ? dsnParts(deps.config.sentryDsn) : null;
  return {
    tunnel: endpoint(deps, { auth: "none" }, async ({ req }) => {
      if (!ours) throw notFound();
      const declared = Number(req.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > TUNNEL_BODY_LIMIT) {
        throw new HttpError(413, "Content Too Large", `The request body must be at most ${TUNNEL_BODY_LIMIT} bytes.`);
      }
      const body = await readText(req, TUNNEL_BODY_LIMIT);
      let header: unknown;
      try {
        header = JSON.parse(body.split("\n", 1)[0]!);
      } catch {
        throw badRequest("Not a Sentry envelope.");
      }
      const dsn = typeof header === "object" && header !== null ? (header as { dsn?: unknown }).dsn : undefined;
      const theirs = typeof dsn === "string" ? dsnParts(dsn) : null;
      if (!theirs || theirs.key !== ours.key || theirs.host !== ours.host || theirs.project !== ours.project) {
        throw badRequest("This envelope is not for this site's error tracker.");
      }
      await enforceLimit(deps, req);

      let upstream: Response;
      try {
        upstream = await forward(`https://${ours.host}/api/${ours.project}/envelope/`, {
          method: "POST",
          headers: { "content-type": "application/x-sentry-envelope" },
          body,
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
      } catch (err) {
        // A warning, not an error: errors are reported to Sentry, which is the thing that's unreachable.
        deps.logger.warn("monitoring.relay_failed", { err });
        throw new HttpError(502, "Bad Gateway", "The error report could not be delivered.");
      }
      await upstream.body?.cancel();
      const headers = new Headers();
      for (const name of PASSED_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
      }
      return new Response(null, { status: upstream.status, headers });
    }),
  };
}

/**
 * Per-IP limit, checked after the cheap checks. It fails open: if the limiter's database is down, that outage is what the
 * reports are about, and Sentry's own spike protection still caps the volume.
 */
async function enforceLimit(deps: Deps, req: Request): Promise<void> {
  const key = `errorReport:ip:${rateLimitSubject(clientIp(req, deps.config.trustProxy))}`;
  let verdict;
  try {
    verdict = await consume(deps.db, key, RATE_LIMITS.errorReport, deps.now());
  } catch (err) {
    deps.logger.warn("monitoring.rate_limit_unavailable", { err });
    return;
  }
  if (!verdict.allowed) {
    throw new HttpError(429, "Too Many Requests", "Rate limit exceeded. Try again later.", { retryAfter: verdict.retryAfterSeconds }, {
      "retry-after": String(verdict.retryAfterSeconds),
    });
  }
}
