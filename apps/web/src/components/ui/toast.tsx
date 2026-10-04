"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Toast = {
  id: number;
  message: string;
  icon?: ReactNode;
  action?: { label: string; onClick: () => void };
  /** When it goes away, as a timestamp: a toast that waited in the queue keeps its real deadline. */
  expiresAt: number;
};

type Show = (t: Omit<Toast, "id" | "expiresAt"> & { duration?: number }) => number;

const ToastContext = createContext<Show>(() => 0);
const DismissContext = createContext<(id: number) => void>(() => {});

/**
 * Toasts show one at a time, bottom-centre, black glass (handoff turn 5 "Toasts"). Later ones queue
 * instead of replacing the current one, so an Undo toast is never pushed away before its window ends;
 * a queued toast whose deadline has already passed is dropped.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Toast[]>([]);
  const [draining, setDraining] = useState(false);
  const seq = useRef(0);

  const show = useCallback<Show>((t) => {
    const id = ++seq.current;
    setQueue((q) => [...q, { ...t, id, expiresAt: Date.now() + (t.duration ?? 5000) }]);
    return id;
  }, []);
  const dismiss = useCallback((id: number) => setQueue((q) => q.filter((t) => t.id !== id)), []);

  const current = queue.find((t) => t.expiresAt > Date.now()) ?? null;
  const remaining = current ? Math.max(0, current.expiresAt - Date.now()) : 0;

  useEffect(() => {
    if (!current) {
      if (queue.length) setQueue([]);
      return;
    }
    setDraining(false);
    const start = requestAnimationFrame(() => setDraining(true));
    // Drop this toast and any queued ones that expired while it was showing.
    const end = setTimeout(() => setQueue((q) => q.filter((t) => t.id !== current.id && t.expiresAt > Date.now())), remaining);
    return () => {
      cancelAnimationFrame(start);
      clearTimeout(end);
    };
    // Keyed on the toast on screen only: re-running on every queue change would restart its timer.
  }, [current?.id]);

  return (
    <ToastContext value={show}>
      <DismissContext value={dismiss}>
        {children}
        <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-7">
          {current && (
            <div
              key={current.id}
              className="glass-primary pointer-events-auto relative flex h-[52px] max-w-full items-center gap-3 overflow-hidden rounded-2xl pr-2 pl-[18px] text-sm text-white motion-safe:animate-[toast-in_.32s_var(--ease)]"
            >
              {current.icon}
              <span className="truncate">{current.message}</span>
              {current.action ? (
                <button
                  type="button"
                  onClick={() => {
                    current.action!.onClick();
                    dismiss(current.id);
                  }}
                  className="h-9 flex-none rounded-[10px] bg-white/12 px-4 font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,.2)] transition hover:bg-white/20 active:scale-[.96]"
                >
                  {current.action.label}
                </button>
              ) : (
                <span className="w-2.5" />
              )}
              <span
                aria-hidden
                className="absolute bottom-0 left-0 h-0.5 bg-white/55"
                style={{ width: draining ? "0%" : "100%", transition: draining ? `width ${remaining}ms linear` : "none" }}
              />
            </div>
          )}
        </div>
      </DismissContext>
    </ToastContext>
  );
}

export const useToast = () => useContext(ToastContext);

/** Removes a toast by the id `useToast()` returned, e.g. an Undo toast whose action no longer applies. */
export const useDismissToast = () => useContext(DismissContext);
