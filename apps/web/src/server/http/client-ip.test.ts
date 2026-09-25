import { describe, expect, it } from "vitest";
import { clientIp, rateLimitSubject } from "./client-ip";

describe("rateLimitSubject", () => {
  it("keys IPv4 per address and IPv6 per /64, so rotating within one allocation doesn't help", () => {
    expect(rateLimitSubject("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitSubject("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(rateLimitSubject("2001:0db8:0001:0002:ffff:eeee:dddd:cccc")).toBe("2001:db8:1:2::/64");
    expect(rateLimitSubject("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitSubject(null)).toBe("unknown");
  });
});

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
