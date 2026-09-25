import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const req = (xff?: string) => new Request("http://localhost/", { headers: xff === undefined ? {} : { "x-forwarded-for": xff } });

describe("clientIp", () => {
  it("ignores forwarding headers unless the proxy is trusted", () => {
    expect(clientIp(req("203.0.113.7"), false)).toBeNull();
  });
  it("reads a single forwarded IPv4 or IPv6 address behind a trusted proxy", () => {
    expect(clientIp(req(" 203.0.113.7 "), true)).toBe("203.0.113.7");
    expect(clientIp(req("2001:db8::1"), true)).toBe("2001:db8::1");
  });
  it("rejects chains and garbage (matches Better Auth, so both key the same client)", () => {
    expect(clientIp(req("203.0.113.7, 10.0.0.1"), true)).toBeNull();
    expect(clientIp(req("not-an-ip"), true)).toBeNull();
    expect(clientIp(req(), true)).toBeNull();
  });
});
