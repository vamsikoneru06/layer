"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useSession, type Moved } from "./session";
import { NAV, SideNav } from "./side-nav";

/** Says once, after sign-in, that designs made in this browser are now in the account. */
function MovedNotice() {
  const session = useSession();
  const toast = useToast();
  const moved = session.status === "user" ? session.moved : undefined;
  const shown = useRef<Moved | undefined>(undefined);
  useEffect(() => {
    if (!moved || shown.current === moved) return;
    shown.current = moved;
    const parts = [];
    if (moved.count) parts.push(`Moved ${moved.count} ${moved.count === 1 ? "design" : "designs"} from this browser to your account.`);
    if (moved.failed) parts.push(`${moved.failed} couldn’t be moved and stay in this browser; VASH tries again next time you sign in.`);
    toast({ message: parts.join(" ") });
  }, [moved, toast]);
  return null;
}

function GuestBanner() {
  const session = useSession();
  if (session.status !== "guest") return null;
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[14px] bg-bg2 px-4 py-2.5 text-sm">
      <span className="text-muted">You’re not signed in. Designs you make are saved in this browser only. Sign in to keep them in your account.</span>
      <Link href="/signin" className="font-medium underline-offset-4 hover:underline">
        Sign in →
      </Link>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="min-h-svh bg-bg text-text">
      <SideNav />

      <div className="flex min-w-0 flex-col">
        <header className="flex h-14 items-center justify-between px-4 md:hidden">
          <Logo />
          <ButtonLink href="/home#create" size="sm" icon={<Plus aria-hidden className="size-3.5" />}>
            New
          </ButtonLink>
        </header>
        {/* Desktop: leave room for the floating side bar (16 px inset + 60 px bar). */}
        <main className="flex min-w-0 flex-col gap-6 px-4 pt-2 pb-28 md:pt-10 md:pr-10 md:pb-12 md:pl-[116px]">
          <GuestBanner />
          <MovedNotice />
          {children}
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t-[.5px] border-line bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        {NAV.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? "page" : undefined}
            className={cn("flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] text-muted transition-colors hover:text-text", active(href) && "font-semibold text-text")}
          >
            <Icon aria-hidden className="size-5" strokeWidth={1.75} />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
