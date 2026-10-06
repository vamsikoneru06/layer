import localFont from "next/font/local";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { THEME_COOKIE, themeAttribute } from "@/lib/theme";
import "./globals.css";

export const metadata = {
  title: "VASH",
  description: "Pick a template, edit the text, colours and shapes, export a PNG. Free, and you can start without an account.",
};

// Fallback for the SF Pro system stack on non-Apple devices. Self-hosted (font-src 'self'); OFL in fonts/.
const inter = localFont({ src: "./fonts/inter-latin-wght.woff2", weight: "100 900", variable: "--font-inter" });

// The CSP nonce is minted per request (src/proxy.ts); prerendered HTML would ship scripts without it.
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  // Settings › Appearance: rendered on the server so a forced theme never flashes the other one first.
  const theme = themeAttribute((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" className={inter.variable} data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
