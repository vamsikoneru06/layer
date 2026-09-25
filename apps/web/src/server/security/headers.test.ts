import { describe, expect, it } from "vitest";
import { buildCsp, createNonce, securityHeaders } from "./headers";

describe("buildCsp", () => {
  it("locks scripts to the nonce and forbids framing and plugins", () => {
    const csp = buildCsp({ nonce: "abc123", isDevelopment: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
  });
  it("allows eval only in development (React refresh)", () => {
    expect(buildCsp({ nonce: "n", isDevelopment: true })).toContain("'unsafe-eval'");
  });
});

describe("securityHeaders", () => {
  it("sets the spec's header set, with HSTS only in production", () => {
    const dev = securityHeaders({ csp: "x", isProduction: false });
    expect(dev).toMatchObject({
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "cross-origin-opener-policy": "same-origin",
    });
    expect(dev["strict-transport-security"]).toBeUndefined();
    expect(securityHeaders({ csp: "x", isProduction: true })["strict-transport-security"]).toMatch(/max-age=63072000/);
  });
});

describe("createNonce", () => {
  it("is 128 random bits, base64", () => {
    const a = createNonce();
    expect(Buffer.from(a, "base64")).toHaveLength(16);
    expect(createNonce()).not.toBe(a);
  });
});
