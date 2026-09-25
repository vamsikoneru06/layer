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
