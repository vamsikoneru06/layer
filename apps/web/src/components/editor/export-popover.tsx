"use client";

import { checkExport, type Editor } from "@vash/engine";
import type { Doc } from "@vash/schema";
import { Check, ChevronDown, Download } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { exportFileName } from "@/lib/export-name";
import { cn } from "@/lib/utils";
import { Switch } from "./fields";

const SCALES = [1, 2, 3] as const;

type Phase = "idle" | "rendering" | "done";

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  // Give the browser a moment to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ExportPopover({ editor, doc }: { editor: Editor | null; doc: Doc }) {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState<number>(2);
  const [transparent, setTransparent] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => setPhase("idle"), 2000);
    return () => clearTimeout(t);
  }, [phase]);

  const check = checkExport(doc, scale);

  async function download() {
    if (!editor || !check.ok) return;
    setPhase("rendering");
    setError(null);
    try {
      const blob = await editor.exportPng({ scale, transparent });
      save(blob, exportFileName(doc.meta.title, scale));
      setPhase("done");
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : "Export failed. Try again.");
    }
  }

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        setOpen(false);
        root.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
      }}
    >
      <button type="button" className={buttonClass("primary", "sm")} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="glass-label">Export</span>
        <ChevronDown aria-hidden className="size-3.5" />
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Export"
          className="absolute top-full right-0 z-40 mt-1.5 flex w-[300px] flex-col gap-4 rounded-2xl bg-bg p-4 shadow-[0_0_0_.5px_var(--line),0_12px_32px_rgba(0,0,0,.16)]"
        >
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Export</h2>
            <span className="text-[13px] text-muted">PNG</span>
          </div>

          <div className="flex flex-col gap-2">
            <span id={`${id}-size`} className="text-[13px] font-medium">
              Size
            </span>
            <div role="radiogroup" aria-labelledby={`${id}-size`} className="flex rounded-[10px] bg-field p-[3px]">
              {SCALES.map((s) => {
                const c = checkExport(doc, s);
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={scale === s}
                    onClick={() => setScale(s)}
                    className={cn(
                      "flex h-[44px] flex-1 flex-col items-center justify-center rounded-[7px] text-muted hover:text-text",
                      scale === s && "bg-(--seg) text-text shadow-(--segsh)",
                    )}
                  >
                    <span className="text-[13px] font-medium">{s}×</span>
                    <span className="text-[11px] tabular-nums">{c.ok ? `${c.width} × ${c.height}` : "Too large"}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between text-[13px] font-medium">
            Transparent background
            <Switch label="Transparent background" checked={transparent} onChange={setTransparent} />
          </div>

          {(error ?? (!check.ok && check.reason)) && (
            <p role="alert" className="text-[13px] text-danger">
              {error ?? (!check.ok && check.reason)}
            </p>
          )}

          <Button
            onClick={() => void download()}
            loading={phase === "rendering"}
            disabled={!editor || !check.ok}
            icon={phase === "done" ? <Check aria-hidden className="size-4" /> : phase === "idle" ? <Download aria-hidden className="size-4" /> : undefined}
          >
            {phase === "rendering" ? "Rendering…" : phase === "done" ? "Downloaded" : "Download"}
          </Button>
        </div>
      )}
    </div>
  );
}
