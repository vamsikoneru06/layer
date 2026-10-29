"use client";

import { checkExport, type Editor } from "@vash/engine";
import type { Doc } from "@vash/schema";
import { Check, ChevronDown, Download } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { exportFileName, type ExportFormat } from "@/lib/export-name";
import { formatFileSize } from "@/lib/file-size";
import { jpegToPdf, pointsFromPixels } from "@/lib/pdf";
import { cn } from "@/lib/utils";
import { NumberField, Segmented, Slider, Switch } from "./fields";

const SCALES = [1, 2, 3] as const;
const FILE_TYPES: { value: ExportFormat; label: string }[] = [
  { value: "png", label: "PNG" },
  { value: "jpg", label: "JPG" },
  { value: "pdf", label: "PDF" },
];

type Phase = "idle" | "rendering" | "done";

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  // Give the browser a moment to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ExportPopover({ editor, doc, open, onOpenChange }: { editor: Editor | null; doc: Doc; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [fileType, setFileType] = useState<ExportFormat>("png");
  const [scale, setScale] = useState<number>(2);
  const [transparent, setTransparent] = useState(false);
  const [bleed, setBleed] = useState(0);
  const [cropMarks, setCropMarks] = useState(false);
  const [quality, setQuality] = useState(0.9);
  const [savedBytes, setSavedBytes] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onOpenChange(false);
    };
    // Escape works wherever focus is (opening from the File menu leaves it on the page), and in the
    // capture phase so the editor's own key handler never sees it and deselects the layer.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onOpenChange(false);
      root.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(() => setPhase("idle"), 2000);
    return () => clearTimeout(t);
  }, [phase]);

  const print = { bleed, cropMarks };
  const check = checkExport(doc, scale, print);

  async function download() {
    if (!editor || !check.ok) return;
    setPhase("rendering");
    setError(null);
    try {
      let file: Blob;
      if (fileType === "png") {
        file = await editor.exportPng({ scale, transparent, ...print });
      } else if (fileType === "jpg") {
        file = await editor.exportImage({ scale, transparent: false, format: "jpeg", quality, ...print });
      } else {
        // JPEG pixels go into a one-page PDF sized to the export (bleed and marks included) in points.
        const jpeg = await editor.exportImage({ scale, transparent: false, format: "jpeg", quality, ...print });
        const bytes = jpegToPdf(
          new Uint8Array(await jpeg.arrayBuffer()),
          { width: check.width, height: check.height },
          { width: pointsFromPixels(check.width / scale), height: pointsFromPixels(check.height / scale) },
        );
        file = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      }
      save(file, exportFileName(doc.meta.title, scale, fileType));
      setSavedBytes(file.size);
      setPhase("done");
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : "Export failed. Try again.");
    }
  }

  return (
    <div ref={root} className="relative">
      <button type="button" className={buttonClass("primary", "sm")} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => onOpenChange(!open)}>
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
            <span className="text-[13px] text-muted">{fileType.toUpperCase()}</span>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">File type</span>
            <Segmented name="File type" value={fileType} options={FILE_TYPES} onChange={setFileType} />
          </div>

          <div className="flex flex-col gap-2">
            <span id={`${id}-size`} className="text-[13px] font-medium">
              Size
            </span>
            <div role="radiogroup" aria-labelledby={`${id}-size`} className="flex rounded-[10px] bg-field p-[3px]">
              {SCALES.map((s) => {
                const c = checkExport(doc, s, print);
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

          {fileType === "png" && (
            <div className="flex items-center justify-between text-[13px] font-medium">
              Transparent background
              <Switch label="Transparent background" checked={transparent} onChange={setTransparent} />
            </div>
          )}

          {fileType === "jpg" && <p className="text-[13px] text-muted">JPG has no transparency, so the background is always included.</p>}

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">Bleed</span>
            <NumberField label="±" name="Bleed in design pixels" value={bleed} min={0} max={30} suffix="px" onCommit={setBleed} />
          </div>

          <div className="flex items-center justify-between text-[13px] font-medium">
            Crop marks
            <Switch label="Crop marks" checked={cropMarks} onChange={setCropMarks} />
          </div>

          {fileType !== "png" && <Slider label="Quality" value={quality} min={0.5} max={1} onChange={(v) => setQuality(v)} />}

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
            {phase === "rendering" ? "Rendering…" : phase === "done" ? `Downloaded${savedBytes === null ? "" : `, ${formatFileSize(savedBytes)}`}` : "Download"}
          </Button>
        </div>
      )}
    </div>
  );
}
