import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("/.well-known/security.txt", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("isn't served until a contact address is configured", () => {
    vi.stubEnv("CONTACT_EMAIL", "");
    expect(GET().status).toBe(404);
  });

  it("lists the contact, a future expiry and the policy (RFC 9116)", async () => {
    vi.stubEnv("CONTACT_EMAIL", "security@example.org");
    vi.stubEnv("APP_ORIGIN", "https://vash.example");
    const res = GET();
    const text = await res.text();
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(text).toContain("Contact: mailto:security@example.org");
    expect(text).toContain("Policy: https://vash.example/terms");
    const expires = new Date(/Expires: (.+)/.exec(text)![1]!);
    expect(expires.getTime()).toBeGreaterThan(Date.now());
  });
});
