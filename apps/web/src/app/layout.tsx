import localFont from "next/font/local";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "VASH",
  description: "Pick a template, drop in your photos, export. Free to use.",
};

// Fallback for the SF Pro system stack on non-Apple devices. Self-hosted (font-src 'self'); OFL in fonts/.
const inter = localFont({ src: "./fonts/inter-latin-wght.woff2", weight: "100 900", variable: "--font-inter" });

// The CSP nonce is minted per request (src/proxy.ts); prerendered HTML would ship scripts without it.
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
