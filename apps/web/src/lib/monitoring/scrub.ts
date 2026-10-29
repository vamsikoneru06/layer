import type { Breadcrumb, Event } from "@sentry/nextjs";

/**
 * Error reports get the same rules as the JSON logger (AGENTS.md): no tokens, signed URLs, emails, cookies or SQL parameters.
 * Shared by the browser and server Sentry setups, so it has no Node or DOM dependencies.
 */

const SHARE_TOKEN_PATH = /(\/s|\/api\/shared)\/[^/?#\s]+/g;
const HTTP_URL = /https?:\/\/[^\s"'<>]+/g;
const URL_CREDENTIALS = /\/\/[^/\s:@]+:[^@\s]+@/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** Drops the query string and fragment (signed URLs carry their signature there) and masks share tokens. */
export function scrubUrl(url: string): string {
  return url.split(/[?#]/, 1)[0]!.replace(SHARE_TOKEN_PATH, "$1/:token");
}

export function scrubText(text: string): string {
  if (text.startsWith("Failed query:")) return "Failed query (SQL and parameters omitted)";
  return text
    .replace(HTTP_URL, scrubUrl)
    .replace(URL_CREDENTIALS, "//[redacted]@")
    .replace(SHARE_TOKEN_PATH, "$1/:token")
    .replace(EMAIL, "[email]");
}

export function scrubBreadcrumb<B extends Breadcrumb>(crumb: B): B {
  const data = crumb.data ? { ...crumb.data } : undefined;
  if (data) {
    for (const key of ["url", "from", "to"]) if (typeof data[key] === "string") data[key] = scrubUrl(data[key]);
  }
  return {
    ...crumb,
    ...(crumb.message !== undefined ? { message: scrubText(crumb.message) } : {}),
    ...(data ? { data } : {}),
  };
}

export function scrubEvent<E extends Event>(event: E): E {
  const { user: _user, request, contexts, ...rest } = event;
  const out = { ...rest } as E;
  if (request) out.request = { ...(request.method ? { method: request.method } : {}), ...(request.url ? { url: scrubUrl(request.url) } : {}) };
  if (out.message) out.message = scrubText(out.message);
  if (out.transaction) out.transaction = scrubText(out.transaction);
  if (out.exception?.values) {
    out.exception = { ...out.exception, values: out.exception.values.map((v) => (v.value ? { ...v, value: scrubText(v.value) } : v)) };
  }
  if (out.breadcrumbs) out.breadcrumbs = out.breadcrumbs.map(scrubBreadcrumb);
  if (contexts) {
    out.contexts = Object.fromEntries(
      Object.entries(contexts).map(([name, ctx]) => [
        name,
        ctx && Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, typeof v === "string" ? scrubText(v) : v])),
      ]),
    );
  }
  return out;
}
