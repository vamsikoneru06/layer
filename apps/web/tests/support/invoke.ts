import type { Handler } from "@/server/http/types";
import { testConfig } from "./config";

export interface CallOptions {
  method?: string;
  path?: string;
  params?: Record<string, string>;
  body?: unknown;
  rawBody?: BodyInit;
  as?: { id: string } | null;
  headers?: Record<string, string>;
  /** Defaults to the app origin on non-GET requests; pass null to omit the header. */
  origin?: string | null;
  ip?: string;
}

export async function call(handler: Handler, opts: CallOptions = {}): Promise<{ status: number; headers: Headers; body: any }> {
  const method = opts.method ?? "GET";
  const headers = new Headers(opts.headers);
  if (method !== "GET" && opts.origin !== null) headers.set("origin", opts.origin ?? testConfig.appOrigin);
  if (opts.as) headers.set("x-test-user-id", opts.as.id);
  headers.set("x-forwarded-for", opts.ip ?? "203.0.113.7");
  let body: BodyInit | undefined = opts.rawBody;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const req = new Request(new URL(opts.path ?? "/api/test", testConfig.appOrigin), { method, headers, body });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  const isJson = /json/.test(res.headers.get("content-type") ?? "");
  return { status: res.status, headers: res.headers, body: isJson && text ? JSON.parse(text) : text };
}
