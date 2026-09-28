"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSession } from "./session";
import { NAV, SideNav } from "./side-nav";

function GuestBanner() {
  const session = useSession();
  if (session.status !== "guest") return null;
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[14px] bg-bg2 px-4 py-2.5 text-sm">
      <span className="text-muted">You’re browsing as a guest. Sign in to save your designs to the cloud.</span>
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
            className={cn("flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] text-muted", active(href) && "font-semibold text-text")}
          >
            <Icon aria-hidden className="size-5" strokeWidth={1.75} />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
