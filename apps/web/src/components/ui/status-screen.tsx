import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";

/** Full-page message for errors and missing pages: logo, icon, title, one plain sentence, actions. */
export function StatusScreen({ icon, title, body, children }: { icon: ReactNode; title: string; body: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col bg-bg px-6 py-8 text-text sm:px-14">
      <Logo />
      <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
        <div aria-hidden className="glass-primary flex size-14 items-center justify-center rounded-2xl text-white [&_svg]:size-6">
          {icon}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="text-sm text-muted">{body}</div>
        <div className="mt-2 flex flex-wrap justify-center gap-3">{children}</div>
      </div>
    </main>
  );
}
