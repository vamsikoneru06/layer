import type { ReactNode } from "react";
import { AppShell } from "@/components/app/app-shell";
import { SessionProvider } from "@/components/app/session";
import { ToastProvider } from "@/components/ui/toast";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <AppShell>{children}</AppShell>
      </ToastProvider>
    </SessionProvider>
  );
}
