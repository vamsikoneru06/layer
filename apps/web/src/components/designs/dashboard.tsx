"use client";

import { FORMATS, LIMITS, type FormatKey } from "@vash/schema";
import { Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { listDesigns, type DesignItem } from "@/lib/api";
import { editedLabel, firstName, greeting } from "@/lib/designs";
import { cn } from "@/lib/utils";
import { DesignThumb } from "./design-thumb";
import { useCreateDesign } from "./use-create-design";

// Outline sizes are the handoff's, drawn to read at a glance rather than to scale.
const PRESETS: { format: Exclude<FormatKey, "custom">; name: string; w: number; h: number }[] = [
  { format: "ig-post", name: "Instagram post", w: 40, h: 40 },
  { format: "ig-story", name: "Story", w: 30, h: 52 },
  { format: "yt-thumbnail", name: "YouTube thumbnail", w: 60, h: 34 },
  { format: "poster", name: "Poster", w: 38, h: 52 },
  { format: "invitation", name: "Invitation", w: 38, h: 54 },
];

function SectionHead({ title, link }: { title: string; link?: { href: string; label: string } }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-lg font-semibold tracking-[-0.02em]">{title}</h2>
      {link && (
        <Link href={link.href} className="text-sm text-muted hover:text-text">
          {link.label}
        </Link>
      )}
    </div>
  );
}

function PresetCard({ name, size, w, h, dashed, busy, onClick }: { name: string; size: string; w: number; h: number; dashed?: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-busy={busy || undefined}
      className="flex h-[140px] flex-col justify-between rounded-2xl bg-bg2 p-3.5 text-left transition-[transform,box-shadow] duration-200 ease-(--ease) hover:-translate-y-[3px] hover:shadow-[0_14px_30px_rgba(0,0,0,.12),inset_0_0_0_.5px_var(--line)] active:translate-y-[-1px] active:scale-[.99]"
    >
      <span className="flex h-[60px] items-center justify-center">
        {busy ? (
          <span className="size-5 rounded-full border-2 border-muted border-r-transparent motion-safe:animate-[lyr-spin_.7s_linear_infinite]" />
        ) : (
          <span className={cn("rounded-[5px] border-[1.5px] border-muted", dashed && "border-dashed")} style={{ width: w, height: h }} />
        )}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{name}</span>
        <span className="text-xs text-muted">{size}</span>
      </span>
    </button>
  );
}

function PixelField({ label, value, onChange, invalid }: { label: string; value: string; onChange: (v: string) => void; invalid: boolean }) {
  return (
    <label className="flex flex-col gap-2 text-[13px] font-medium">
      {label}
      <input className="field tabular-nums" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value.trim())} aria-invalid={invalid || undefined} />
    </label>
  );
}

function CustomSizeDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (size: { width: number; height: number }) => void }) {
  const [width, setWidth] = useState("1080");
  const [height, setHeight] = useState("1350");
  const valid = (v: string) => /^\d+$/.test(v) && +v >= LIMITS.artboardMin && +v <= LIMITS.artboardMax;
  const ok = valid(width) && valid(height);

  return (
    <Dialog open={open} onClose={onClose} title="Custom size">
      <form
        className="flex flex-col gap-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (ok) onCreate({ width: +width, height: +height });
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <PixelField label="Width" value={width} onChange={setWidth} invalid={!valid(width)} />
          <PixelField label="Height" value={height} onChange={setHeight} invalid={!valid(height)} />
        </div>
        <p className={cn("text-[13px]", ok ? "text-muted" : "text-danger")}>
          Pixels, from {LIMITS.artboardMin} to {LIMITS.artboardMax.toLocaleString("en-US")} on each side.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ok}>
            Create design
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RecentDesigns() {
  const session = useSession();
  const [designs, setDesigns] = useState<DesignItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.status !== "user") return;
    listDesigns({ limit: 5 })
      .then((page) => setDesigns(page.items))
      .catch((err: Error) => setError(err.message));
  }, [session.status]);

  if (session.status === "guest") {
    return (
      <EmptyState
        icon={<Sparkles />}
        title="Your first design is a minute away"
        body="Sign in and your designs will be waiting here next time."
        action={
          <Link href="/signin" className="text-sm font-medium underline-offset-4 hover:underline">
            Sign in →
          </Link>
        }
      />
    );
  }
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (designs?.length === 0) {
    return <EmptyState icon={<Sparkles />} title="Your first design is a minute away" body="Pick a size above to start." />;
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {(designs ?? Array.from({ length: 5 }, () => null)).map((d, i) =>
        d ? (
          <Link key={d.id} href={`/edit/${d.id}`} className="group flex flex-col gap-2.5 rounded-[14px]">
            <DesignThumb
              width={d.width}
              height={d.height}
              box={{ width: 190, height: 150 }}
              className="h-[180px] transition-[transform,box-shadow] duration-200 ease-(--ease) group-hover:-translate-y-[3px] group-hover:shadow-[0_14px_30px_rgba(0,0,0,.12),inset_0_0_0_.5px_var(--line)]"
            />
            <span className="flex flex-col gap-0.5 px-0.5">
              <span className="truncate text-sm font-medium">{d.title}</span>
              <span className="text-xs text-muted">{editedLabel(d.updatedAt)}</span>
            </span>
          </Link>
        ) : (
          <div key={i} className="flex flex-col gap-2.5">
            <div className="h-[180px] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-[14px] bg-bg2" />
            <div className="h-4 w-2/3 rounded bg-field" />
          </div>
        ),
      )}
    </div>
  );
}

export function Dashboard() {
  const router = useRouter();
  const session = useSession();
  const { create, busy } = useCreateDesign();
  const [customOpen, setCustomOpen] = useState(false);
  const [hello, setHello] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  // Local time decides the greeting, so it is only known in the browser.
  useEffect(() => setHello(greeting()), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const name = session.status === "user" ? firstName(session.me.name) : null;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="min-h-[41px] text-[clamp(30px,5vw,40px)] leading-[1.02] font-bold tracking-[-0.035em]">
          {hello && session.status !== "loading" ? `${hello}${name ? `, ${name}` : ""}` : ""}
        </h1>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const q = search.current?.value.trim();
            router.push(q ? `/designs?q=${encodeURIComponent(q)}` : "/designs");
          }}
          className="glass-secondary flex h-[42px] w-full items-center gap-2.5 rounded-full px-4 text-sm text-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-text lg:w-[320px]"
        >
          <Search aria-hidden className="size-[17px] flex-none" />
          <input ref={search} name="q" aria-label="Search designs" placeholder="Search designs" className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-muted" />
          <kbd className="hidden h-5 min-w-5 items-center justify-center rounded-[5px] bg-field px-[5px] font-sans text-[11px] font-medium text-muted shadow-[inset_0_-1px_0_var(--line)] sm:inline-flex">
            ⌘K
          </kbd>
        </form>
      </div>

      <section id="create" className="flex scroll-mt-10 flex-col gap-3.5">
        <SectionHead title="Create a design" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {PRESETS.map((p) => (
            <PresetCard
              key={p.format}
              name={p.name}
              size={`${FORMATS[p.format].width} × ${FORMATS[p.format].height}`}
              w={p.w}
              h={p.h}
              busy={busy === p.format}
              onClick={() => create(p.format, p.format)}
            />
          ))}
          <PresetCard
            name="Custom size…"
            size="Any size"
            w={46}
            h={38}
            dashed
            busy={busy === "custom"}
            onClick={() => (session.status === "user" ? setCustomOpen(true) : router.push("/signin"))}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3.5">
        <SectionHead title="Continue editing" link={session.status === "user" ? { href: "/designs", label: "All designs" } : undefined} />
        <RecentDesigns />
      </section>

      <CustomSizeDialog
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        onCreate={(size) => {
          setCustomOpen(false);
          create("custom", "custom", size);
        }}
      />
    </div>
  );
}
