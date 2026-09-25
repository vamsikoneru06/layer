import { randomUUID } from "node:crypto";
import type { CurrentUser, Deps } from "../deps";
import { consume, type RateLimitRule } from "../rate-limit/limiter";
import { clientIp } from "./client-ip";
import { HttpError, problem } from "./problem";
import type { Handler } from "./types";

type AuthMode = "none" | "optional" | "user" | "admin";
type UserFor<A extends AuthMode> = A extends "none" ? null : A extends "optional" ? CurrentUser | null : CurrentUser;

export interface EndpointOptions<A extends AuthMode> {
  auth: A;
  rateLimit?: { name: string; rule: RateLimitRule; by: "user" | "ip" };
}

export interface EndpointInput<U> {
  req: Request;
  params: Record<string, string>;
  user: U;
  requestId: string;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Share tokens are credentials; they must never reach the logs. */
const loggablePath = (pathname: string) => pathname.replace(/^\/api\/shared\/[^/]+/, "/api/shared/:token");

export function endpoint<A extends AuthMode>(
  deps: Deps,
  options: EndpointOptions<A>,
  fn: (input: EndpointInput<UserFor<A>>) => Promise<Response>,
): Handler {
  return async (req, ctx) => {
    const requestId = randomUUID();
    const started = performance.now();
    const path = loggablePath(new URL(req.url).pathname);
    let userId: string | undefined;
    const done = (status: number) =>
      deps.logger.info("request", { requestId, method: req.method, path, status, ms: Math.round(performance.now() - started), userId });

    try {
      if (!SAFE_METHODS.has(req.method) && req.headers.get("origin") !== deps.config.appOrigin) {
        throw new HttpError(403, "Forbidden", "Cross-origin requests are not allowed.");
      }
      const user = options.auth === "none" ? null : await deps.authenticate(req);
      userId = user?.id;
      if ((options.auth === "user" || options.auth === "admin") && !user) {
        throw new HttpError(401, "Unauthorized", "Sign in to continue.");
      }
      if (options.auth === "admin" && user?.role !== "admin") {
        throw new HttpError(403, "Forbidden", "This action requires an administrator.");
      }
      if (options.rateLimit) await enforceRateLimit(deps, req, options.rateLimit, user);

      const res = await fn({ req, params: await ctx.params, user: user as UserFor<A>, requestId });
      res.headers.set("x-request-id", requestId);
      if (!res.headers.has("cache-control")) res.headers.set("cache-control", "no-store");
      done(res.status);
      return res;
    } catch (err) {
      if (err instanceof HttpError) {
        done(err.status);
        return problem(err.status, err.title, err.detail, requestId, err.extra, err.headers);
      }
      deps.logger.error("request.failed", { requestId, method: req.method, path, userId, err });
      return problem(500, "Internal Server Error", "Something went wrong on our side. Quote the request id if you contact support.", requestId);
    }
  };
}

async function enforceRateLimit(
  deps: Deps,
  req: Request,
  limit: NonNullable<EndpointOptions<AuthMode>["rateLimit"]>,
  user: CurrentUser | null,
): Promise<void> {
  const subject = limit.by === "user" && user ? `user:${user.id}` : `ip:${clientIp(req, deps.config.trustProxy) ?? "unknown"}`;
  const verdict = await consume(deps.db, `${limit.name}:${subject}`, limit.rule, deps.now());
  if (!verdict.allowed) {
    throw new HttpError(
      429,
      "Too Many Requests",
      "Rate limit exceeded. Try again later.",
      { retryAfter: verdict.retryAfterSeconds },
      { "retry-after": String(verdict.retryAfterSeconds) },
    );
  }
}
