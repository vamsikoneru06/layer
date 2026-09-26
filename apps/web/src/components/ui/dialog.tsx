"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native modal <dialog>: focus trap, Escape and inert background come from the browser. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={title}
      className="m-auto w-[min(420px,calc(100vw-32px))] rounded-[20px] bg-bg p-0 text-text shadow-[0_0_0_.5px_var(--line),0_24px_60px_rgba(0,0,0,.25)] backdrop:bg-black/30 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-5 p-6">
        <h2 className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
