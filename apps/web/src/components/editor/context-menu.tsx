"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { MENU_PANEL, MenuItems, moveMenuFocus, type MenuItem } from "@/components/ui/menu";
import { clampMenuPosition } from "@/lib/menu-position";
import { cn } from "@/lib/utils";

/** A menu at the pointer (viewport pixels). Escape, an outside click or resizing closes it. */
export function ContextMenu({ at, items, onClose, id }: { at: { x: number; y: number } | null; items: MenuItem[]; onClose: () => void; id?: string }) {
  const list = useRef<HTMLDivElement>(null);

  // Opened where the pointer is, then nudged back on screen once its size is known.
  useLayoutEffect(() => {
    const el = list.current;
    if (!at || !el) return;
    const r = el.getBoundingClientRect();
    const p = clampMenuPosition(at, { width: r.width, height: r.height }, { width: window.innerWidth, height: window.innerHeight });
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const away = (e: PointerEvent) => {
      if (!list.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", away);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [at, onClose]);

  if (!at) return null;
  return (
    <div
      ref={list}
      id={id}
      role="menu"
      aria-label="Layer actions"
      className={cn("fixed z-50 max-h-[calc(100svh-16px)] overflow-y-auto", MENU_PANEL)}
      style={{ left: at.x, top: at.y }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        else moveMenuFocus(e, list.current);
      }}
    >
      <MenuItems items={items} onDone={onClose} />
    </div>
  );
}
