import { isIP } from "node:net";

/**
 * Route handlers can't see the socket address, so the client IP comes only from a proxy we trust
 * to overwrite X-Forwarded-For (Vercel). Like Better Auth, accept exactly one address; anything
 * else is spoofable, so return null and let callers use a shared "unknown" bucket.
 */
export function clientIp(req: Request, trustProxy: boolean): string | null {
  if (!trustProxy) return null;
  const parts = (req.headers.get("x-forwarded-for") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 1) return null;
  const ip = parts[0]!;
  return isIP(ip) ? ip : null;
}

/** Rate-limit bucket for an address: IPv4 as-is; IPv6 by /64, since one client usually owns a whole /64. */
export function rateLimitSubject(ip: string | null): string {
  if (ip === null) return "unknown";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (isIP(ip) !== 6) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((g) => (Number.parseInt(g, 16) || 0).toString(16)).join(":")}::/64`;
}
