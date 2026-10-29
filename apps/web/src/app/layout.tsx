import localFont from "next/font/local";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { THEME_COOKIE, themeAttribute } from "@/lib/theme";
import "./globals.css";

export const metadata = {
  // Absolute URLs for canonical and Open Graph tags; unset at build time, where nothing is rendered.
  metadataBase: process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN) : undefined,
  title: "VASH",
  description: "Pick a template, edit the text, colours and shapes, export a PNG. Free, and you can start without an account.",
};

// Fallback for the SF Pro system stack on non-Apple devices. Self-hosted (font-src 'self'); OFL in fonts/.
const inter = localFont({ src: "./fonts/inter-latin-wght.woff2", weight: "100 900", variable: "--font-inter" });

/**
 * The Trusted Types "default" policy, for the production CSP's require-trusted-types-for (server/security/headers.ts).
 * Next's bundler loads code-split chunks by assigning plain strings to script.src; this lets exactly those through
 * (same-origin /_next/ URLs) and nothing else. It defines no HTML or script rules, so strings in innerHTML, eval-like
 * and other sinks stay blocked. It returns the URL exactly as given: the bundler finds loaded chunks by their src
 * attribute, and an absolute URL there stalled client-side navigation. A fixed string, never built from input.
 */
const TRUSTED_TYPES_POLICY = `(function(){var t=window.trustedTypes;if(!t||!t.createPolicy)return;try{t.createPolicy("default",{createScriptURL:function(s){var u=new URL(s,location.href);if(u.origin===location.origin&&u.pathname.indexOf("/_next/")===0)return s;throw new TypeError("Blocked script URL: "+u.href)}})}catch(e){}})();`;

// The CSP nonce is minted per request (src/proxy.ts); prerendered HTML would ship scripts without it.
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // Settings › Appearance: rendered on the server so a forced theme never flashes the other one first.
  const theme = themeAttribute((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" className={inter.variable} data-theme={theme}>
      <head>
        {/*
          Inline so it runs before any chunk can load (a separate file would race Next's async scripts). The only
          lint exception in the app: the HTML is the constant above, never user data. Browsers hide a nonce from the DOM
          after parsing, so it never matches on hydration.
        */}
        {/* eslint-disable-next-line no-restricted-syntax -- constant script, see TRUSTED_TYPES_POLICY */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: TRUSTED_TYPES_POLICY }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
