"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type MenuItem = { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean } | "separator";

type TriggerProps = {
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string;
  onClick: () => void;
};

/** A small dropdown menu: Escape or an outside click closes it, arrow keys move between items. */
export function Menu({
  trigger,
  items,
  align = "end",
  side = "bottom",
  className,
}: {
  trigger: (props: TriggerProps) => ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  side?: "top" | "bottom";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      root.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = [...(list.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    all[(at + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
  };

  return (
    <div ref={root} className={cn("relative", className)} onKeyDown={onKeyDown}>
      {trigger({ "aria-haspopup": "menu", "aria-expanded": open, "aria-controls": id, onClick: () => setOpen((o) => !o) })}
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          className={cn(
            "absolute z-40 min-w-[200px] rounded-2xl bg-bg p-1.5 shadow-[0_0_0_.5px_var(--line),0_12px_32px_rgba(0,0,0,.16)]",
            align === "end" ? "right-0" : "left-0",
            side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
          )}
        >
          {items.map((item, i) =>
            item === "separator" ? (
              <div key={`sep-${i}`} role="separator" className="mx-2 my-1 h-[.5px] bg-line" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  "flex h-9 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left text-sm outline-none hover:bg-field focus-visible:bg-field",
                  item.danger && "text-danger",
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
