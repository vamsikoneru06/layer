import { connection } from "next/server";
import type { ReactNode } from "react";

export const metadata = { title: "VASH" };

// The CSP nonce is minted per request (src/proxy.ts); prerendered HTML would ship scripts without it.
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
