import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, createNonce, securityHeaders } from "./server/security/headers";

/** Next 16 "proxy" (formerly middleware): a per-request CSP nonce that Next applies to its own scripts. */
export function proxy(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const csp = buildCsp({ nonce, isDevelopment: process.env.NODE_ENV === "development" });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(securityHeaders({ csp, isProduction: process.env.NODE_ENV === "production" }))) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
