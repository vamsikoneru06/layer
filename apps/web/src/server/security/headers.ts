export function createNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}

/** `storageOrigins` lets pages load photos from, and the browser PUT uploads to, object storage. */
export function buildCsp({ nonce, isDevelopment, storageOrigins = [] }: { nonce: string; isDevelopment: boolean; storageOrigins?: string[] }): string {
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDevelopment ? ["'unsafe-eval'"] : [])],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "blob:", "data:", ...storageOrigins],
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...storageOrigins],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ...(isDevelopment ? [] : [["upgrade-insecure-requests"] as [string]]),
  ];
  return directives.map((d) => d.join(" ")).join("; ");
}

export function securityHeaders({ csp, isProduction }: { csp: string; isProduction: boolean }): Record<string, string> {
  return {
    "content-security-policy": csp,
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    // Nothing in VASH needs these; denying them limits what an injected script or embedded page could reach.
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), browsing-topics=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "x-permitted-cross-domain-policies": "none",
    "origin-agent-cluster": "?1",
    ...(isProduction ? { "strict-transport-security": "max-age=63072000; includeSubDomains; preload" } : {}),
  };
}
