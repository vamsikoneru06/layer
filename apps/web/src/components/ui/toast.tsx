"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Toast = {
  id: number;
  message: string;
  icon?: ReactNode;
  action?: { label: string; onClick: () => void };
  /** ms before it dismisses itself; the progress bar tracks it. */
  duration: number;
};

type Show = (t: Omit<Toast, "id" | "duration"> & { duration?: number }) => void;

const ToastContext = createContext<Show>(() => {});

/** One toast at a time, bottom-centre, black glass (handoff turn 5 "Toasts"). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [draining, setDraining] = useState(false);
  const seq = useRef(0);

  const show = useCallback<Show>((t) => {
    setDraining(false);
    setToast({ duration: 5000, ...t, id: ++seq.current });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const start = requestAnimationFrame(() => setDraining(true));
    const end = setTimeout(() => setToast(null), toast.duration);
    return () => {
      cancelAnimationFrame(start);
      clearTimeout(end);
    };
  }, [toast]);

  return (
    <ToastContext value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-7">
        {toast && (
          <div
            key={toast.id}
            className="glass-primary pointer-events-auto relative flex h-[52px] max-w-full items-center gap-3 overflow-hidden rounded-full pr-2 pl-[18px] text-sm text-white motion-safe:animate-[toast-in_.32s_var(--ease)]"
          >
            {toast.icon}
            <span className="truncate">{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  toast.action!.onClick();
                  setToast(null);
                }}
                className="h-9 flex-none rounded-full bg-white/12 px-4 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,.2)] transition hover:bg-white/20 active:scale-[.96]"
              >
                {toast.action.label}
              </button>
            ) : (
              <span className="w-2.5" />
            )}
            <span
              aria-hidden
              className="absolute bottom-0 left-0 h-0.5 bg-white/55"
              style={{ width: draining ? "0%" : "100%", transition: draining ? `width ${toast.duration}ms linear` : "none" }}
            />
          </div>
        )}
      </div>
    </ToastContext>
  );
}

export const useToast = () => useContext(ToastContext);
