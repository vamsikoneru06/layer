import { getCookies } from "better-auth/cookies";
import type { AppConfig } from "../config";

/** Better Auth's cookie settings; shared so the names below match the ones it actually sets. */
export function authCookieOptions(config: AppConfig) {
  return {
    useSecureCookies: config.isProduction,
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax" as const, secure: config.isProduction },
  };
}

/** The session cookie's name as Better Auth sets it (it gains a __Secure- prefix in production). */
export const sessionCookieName = (config: AppConfig): string =>
  getCookies({ baseURL: config.appOrigin, advanced: authCookieOptions(config) }).sessionToken.name;

/** Set-Cookie values that expire the session cookies, for responses outside Better Auth's own routes. */
export function expiredSessionCookies(config: AppConfig): string[] {
  const { sessionToken, sessionData, dontRememberToken } = getCookies({ baseURL: config.appOrigin, advanced: authCookieOptions(config) });
  return [sessionToken, sessionData, dontRememberToken].map(({ name, attributes }) =>
    [`${name}=`, "Max-Age=0", `Path=${attributes.path ?? "/"}`, "HttpOnly", "SameSite=Lax", ...(attributes.secure ? ["Secure"] : [])].join("; "),
  );
}
