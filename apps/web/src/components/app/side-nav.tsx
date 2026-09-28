"use client";

import { House, Images, LayoutGrid, LayoutTemplate, LogIn, LogOut, Plus, Settings, type LucideIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Menu } from "@/components/ui/menu";
import { signOut } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Avatar } from "./avatar";
import { useSession } from "./session";

export const NAV: readonly { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/home", label: "Home", Icon: House },
  { href: "/designs", label: "Designs", Icon: LayoutGrid },
  { href: "/media", label: "Media", Icon: Images },
  { href: "/templates", label: "Templates", Icon: LayoutTemplate },
  { href: "/settings", label: "Settings", Icon: Settings },
];

/** Item height + gap, in px: the active highlight moves by this much per item. */
const ITEM = 44;
const GAP = 6;

/** The label beside an icon-only item, shown on hover and keyboard focus. */
function Tip({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-full z-50 ml-3 -translate-x-1 -translate-y-1/2 rounded-md bg-text px-2 py-1 text-xs font-medium whitespace-nowrap text-bg opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 motion-reduce:transition-none"
    >
      {children}
    </span>
  );
}

const ITEM_CLASS =
  "group relative flex size-11 items-center justify-center rounded-xl text-muted transition-colors hover:bg-field hover:text-text focus-visible:text-text aria-[current=page]:hover:bg-transparent";

function Profile() {
  const session = useSession();
  const router = useRouter();
  if (session.status === "loading") return <span className="size-11 animate-[shimmer_1.4s_ease-in-out_infinite] rounded-xl bg-field" />;
  if (session.status !== "user") {
    return (
      <Link href="/signin" aria-label="Sign in" className={ITEM_CLASS}>
        <LogIn aria-hidden className="size-5" strokeWidth={1.75} />
        <Tip>Sign in</Tip>
      </Link>
    );
  }
  const { me } = session;
  return (
    <Menu
      side="top"
      align="start"
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
        <button type="button" {...props} aria-label={`Account: ${me.name || me.email}`} className={cn(ITEM_CLASS, "hover:bg-field")}>
          <Avatar me={me} size={30} />
          <Tip>{me.name || me.email}</Tip>
        </button>
      )}
    />
  );
}

/**
 * The desktop navigation: a floating bar of icons pinned to the left edge. The current page gets a
 * raised highlight that slides between items; labels show as tooltips on hover and focus.
 */
export function SideNav() {
  const pathname = usePathname();
  const index = NAV.findIndex(({ href }) => pathname === href || pathname.startsWith(`${href}/`));

  return (
    <aside className="fixed top-1/2 left-4 z-40 hidden -translate-y-1/2 flex-col items-center gap-3 rounded-2xl bg-bg p-2 shadow-[0_0_0_.5px_var(--line),0_12px_32px_rgba(0,0,0,.12)] md:flex">
      <Link href="/home" aria-label="VASH home" className="group relative flex size-11 items-center justify-center rounded-xl transition-colors hover:bg-field">
        <Image src="/vash-logo.png" alt="" width={30} height={30} className="size-[30px] rounded-lg object-cover" priority />
        <Tip>VASH</Tip>
      </Link>

      <div aria-hidden className="h-[.5px] w-7 bg-line" />

      <nav aria-label="Main" className="relative flex flex-col" style={{ gap: GAP }}>
        {index >= 0 && (
          <span
            aria-hidden
            className="absolute top-0 left-0 size-11 rounded-xl bg-(--seg) shadow-(--segsh) transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{ transform: `translateY(${index * (ITEM + GAP)}px)` }}
          >
            {/* A soft neutral glow under the active item. */}
            <span className="absolute inset-1 -z-10 rounded-xl bg-text/15 blur-md" />
          </span>
        )}
        {NAV.map(({ href, label, Icon }, i) => (
          <Link key={href} href={href} aria-label={label} aria-current={i === index ? "page" : undefined} className={cn(ITEM_CLASS, i === index && "text-text")}>
            <Icon
              aria-hidden
              className={cn("relative size-5 transition-transform duration-300 motion-reduce:transition-none", i === index && "scale-115")}
              strokeWidth={i === index ? 2 : 1.75}
            />
            <Tip>{label}</Tip>
          </Link>
        ))}
      </nav>

      <div aria-hidden className="h-[.5px] w-7 bg-line" />

      <Link href="/home#create" aria-label="New design" className="glass-btn glass-primary group relative size-11 rounded-xl">
        <Plus aria-hidden className="size-5" />
        <Tip>New design</Tip>
      </Link>

      <Profile />
    </aside>
  );
}
