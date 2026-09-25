import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

describe("proxy", () => {
  it("adds a fresh CSP nonce and the security headers to every response", () => {
    const a = proxy(new NextRequest("http://localhost:3000/templates"));
    const b = proxy(new NextRequest("http://localhost:3000/templates"));
    const nonceA = /'nonce-([^']+)'/.exec(a.headers.get("content-security-policy") ?? "")?.[1];
    const nonceB = /'nonce-([^']+)'/.exec(b.headers.get("content-security-policy") ?? "")?.[1];
    expect(nonceA).toBeTruthy();
    expect(nonceA).not.toBe(nonceB);
    expect(a.headers.get("x-frame-options")).toBe("DENY");
    expect(a.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
