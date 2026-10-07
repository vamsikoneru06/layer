import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { scrubBreadcrumb, scrubEvent, scrubText, scrubUrl } from "./scrub";

describe("scrubUrl", () => {
  it("drops query strings and fragments, where signed URLs keep their signatures", () => {
    expect(scrubUrl("https://p.supabase.co/storage/v1/s3/vash-private/u/1.png?X-Amz-Signature=abc&X-Amz-Credential=k")).toBe(
      "https://p.supabase.co/storage/v1/s3/vash-private/u/1.png",
    );
    expect(scrubUrl("/edit/123#layer=4")).toBe("/edit/123");
  });

  it("replaces share tokens in page and API paths", () => {
    expect(scrubUrl("https://vash.vercel.app/s/AbC123_-xyzAbC123_-xy?ref=x")).toBe("https://vash.vercel.app/s/:token");
    expect(scrubUrl("/api/shared/AbC123_-xyz/remix")).toBe("/api/shared/:token/remix");
    expect(scrubUrl("/api/shared/AbC123_-xyz")).toBe("/api/shared/:token");
  });

  it("leaves other paths alone", () => {
    expect(scrubUrl("/storage/v1/s3/bucket/key.png")).toBe("/storage/v1/s3/bucket/key.png");
    expect(scrubUrl("/templates/9f0c")).toBe("/templates/9f0c");
  });
});

describe("scrubText", () => {
  it("replaces email addresses", () => {
    expect(scrubText("no account for jane.doe+v@example.co.in, sorry")).toBe("no account for [email], sorry");
  });

  it("drops SQL and bound parameters from Drizzle's failed-query messages", () => {
    expect(scrubText('Failed query: select * from "user" where email = $1\nparams: jane@example.com')).toBe(
      "Failed query (SQL and parameters omitted)",
    );
  });

  it("removes credentials from connection strings and query strings from URLs in the text", () => {
    expect(scrubText("connect to postgres://vash:hunter2@ep-x.neon.tech/db failed")).toBe("connect to postgres://[redacted]@ep-x.neon.tech/db failed");
    expect(scrubText("GET https://p.supabase.co/o/k.png?X-Amz-Signature=abc returned 403")).toBe("GET https://p.supabase.co/o/k.png returned 403");
    expect(scrubText("fetch /api/shared/AbC123 failed")).toBe("fetch /api/shared/:token failed");
  });
});

describe("scrubEvent", () => {
  it("removes the user, cookies, headers, bodies and query strings, and scrubs every URL and message", () => {
    const event = {
      type: undefined,
      message: "for jane@example.com",
      transaction: "/s/AbC123_-xyz",
      user: { id: "u1", email: "jane@example.com", ip_address: "1.2.3.4" },
      request: {
        method: "POST",
        url: "https://vash.vercel.app/api/shared/AbC123/remix?x=1",
        cookies: { "better-auth.session_token": "t" },
        headers: { authorization: "Bearer t", cookie: "c" },
        data: '{"email":"jane@example.com"}',
        query_string: "x=1",
        env: { REMOTE_ADDR: "1.2.3.4" },
      },
      exception: { values: [{ type: "Error", value: "Failed query: select 1\nparams: jane@example.com" }, { type: "TypeError" }] },
      breadcrumbs: [
        { category: "fetch", data: { url: "https://p.supabase.co/o/1.png?X-Amz-Signature=abc", method: "GET" } },
        { category: "navigation", data: { from: "/s/AbC123", to: "/edit/1?tab=photos" } },
        { category: "console", message: "saving for jane@example.com" },
      ],
      contexts: { nextjs: { request_path: "/s/AbC123", route_type: "render" } },
    } as unknown as ErrorEvent;

    const out = scrubEvent(event);
    expect(out.user).toBeUndefined();
    expect(out.request).toEqual({ method: "POST", url: "https://vash.vercel.app/api/shared/:token/remix" });
    expect(out.message).toBe("for [email]");
    expect(out.transaction).toBe("/s/:token");
    expect(out.exception?.values?.map((v) => v.value)).toEqual(["Failed query (SQL and parameters omitted)", undefined]);
    expect(out.breadcrumbs?.map((b) => b.data ?? b.message)).toEqual([
      { url: "https://p.supabase.co/o/1.png", method: "GET" },
      { from: "/s/:token", to: "/edit/1" },
      "saving for [email]",
    ]);
    expect(out.contexts?.nextjs).toEqual({ request_path: "/s/:token", route_type: "render" });
    expect(JSON.stringify(out)).not.toMatch(/jane|AbC123|Signature|Bearer|1\.2\.3\.4/);
  });
});

describe("scrubBreadcrumb", () => {
  it("scrubs a breadcrumb on its own, for beforeBreadcrumb", () => {
    const crumb: Breadcrumb = { category: "xhr", data: { url: "/api/shared/AbC123?x=1" }, message: "to a@b.co" };
    expect(scrubBreadcrumb(crumb)).toEqual({ category: "xhr", data: { url: "/api/shared/:token" }, message: "to [email]" });
  });
});
