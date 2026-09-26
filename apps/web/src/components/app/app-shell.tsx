"use client";

import { House, Images, LayoutGrid, LayoutTemplate, LogOut, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { signOut, type Me } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSession } from "./session";

const NAV = [
  { href: "/home", label: "Home", Icon: House },
  { href: "/designs", label: "Designs", Icon: LayoutGrid },
  { href: "/media", label: "Media", Icon: Images },
  { href: "/templates", label: "Templates", Icon: LayoutTemplate },
  { href: "/settings", label: "Settings", Icon: Settings },
] as const;

function initials(me: Me): string {
  const source = me.name.trim() || me.email;
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function Avatar({ me, size = 32 }: { me: Me; size?: number }) {
  // Initials rather than the provider photo: img-src is 'self' only.
  return (
    <span
      aria-hidden
      className="glass-primary flex flex-none items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(me)}
    </span>
  );
}

function Profile() {
  const session = useSession();
  const router = useRouter();
  if (session.status === "loading") return <div className="h-12 animate-[shimmer_1.4s_ease-in-out_infinite] rounded-xl bg-field" />;
  if (session.status !== "user") {
    return (
      <ButtonLink href="/signin" variant="secondary" className="w-full">
        Sign in
      </ButtonLink>
    );
  }
  const { me } = session;
  return (
    <Menu
      side="top"
      align="start"
      className="w-full"
      items={[
        { label: "Settings", icon: <Settings aria-hidden className="size-4" />, onSelect: () => router.push("/settings") },
        "separator",
        {
          label: "Sign out",
          icon: <LogOut aria-hidden className="size-4" />,
          onSelect: async () => {
            await signOut().catch(() => {});
            window.location.href = "/";
          },
        },
      ]}
      trigger={(props) => (
        <button type="button" {...props} className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left hover:bg-field">
          <Avatar me={me} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium">{me.name || me.email}</span>
            <span className="truncate text-xs text-muted">{me.handle ? `@${me.handle}` : me.email}</span>
          </span>
        </button>
      )}
    />
  );
}

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
    <div className="min-h-svh bg-bg text-text md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-svh flex-col gap-0.5 border-r-[.5px] border-line px-3.5 py-5 md:flex">
        <div className="px-2 pb-[22px]">
          <Logo />
        </div>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {NAV.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={cn("flex h-[38px] items-center gap-2.5 rounded-[10px] px-2.5 text-sm hover:bg-field", active(href) && "bg-field font-semibold")}
            >
              <Icon aria-hidden className="size-[18px] flex-none" strokeWidth={1.75} />
              {label}
            </Link>
          ))}
        </nav>
        <ButtonLink href="/home#create" className="mt-4 w-full" icon={<Plus aria-hidden className="size-4" />}>
          New design
        </ButtonLink>
        <div className="flex-1" />
        <Profile />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex h-14 items-center justify-between px-4 md:hidden">
          <Logo />
          <ButtonLink href="/home#create" size="sm" icon={<Plus aria-hidden className="size-3.5" />}>
            New
          </ButtonLink>
        </header>
        <main className="flex min-w-0 flex-col gap-6 px-4 pt-2 pb-28 md:px-10 md:pt-10 md:pb-12">
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
