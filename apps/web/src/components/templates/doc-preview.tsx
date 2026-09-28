"use client";

import { fontRequests, renderDoc, type Measure } from "@vash/engine";
import type { Doc } from "@vash/schema";
import { useEffect, useRef } from "react";
import { fitBox } from "@/lib/designs";
import { cn } from "@/lib/utils";
// Template text uses the self-hosted editor fonts.
import "@/components/editor/fonts.css";

function canvasMeasure(): Measure {
  const ctx = document.createElement("canvas").getContext("2d")!;
  return (text, font, size) => {
    ctx.font = `${font.style} ${font.weight} ${size}px "${font.family}", system-ui, sans-serif`;
    return ctx.measureText(text).width;
  };
}

/**
 * A design drawn by the editor's own renderer. It fills its parent's width or height (whichever the
 * design's shape reaches first); `box` sets the drawing resolution. Empty photo frames show their
 * placeholder. Redraws once the design's fonts have loaded, so the text matches the editor.
 */
export function DocPreview({ doc, box, className }: { doc: Doc; box: { width: number; height: number }; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = fitBox(doc.artboard.width, doc.artboard.height, box.width, box.height);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(size.width * dpr);
    el.height = Math.round(size.height * dpr);
    const draw = () => {
      const s = (size.width / doc.artboard.width) * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, el.width, el.height);
      renderDoc(ctx, doc, [s, 0, 0, s, 0, 0], { measure: canvasMeasure(), image: () => "loading", dpr });
    };
    draw();
    let live = true;
    void Promise.all(fontRequests(doc).map((f) => document.fonts.load(f).catch(() => []))).then(() => live && draw());
    return () => {
      live = false;
    };
  }, [doc, size.width, size.height]);

  const { width, height } = doc.artboard;
  const fill = height >= width ? { height: "100%" } : { width: "100%" };
  return (
    <canvas
      ref={canvas}
      aria-hidden
      className={cn("max-h-full max-w-full rounded-[3px] shadow-[0_6px_16px_rgba(0,0,0,.16),0_0_0_.5px_rgba(0,0,0,.06)]", className)}
      style={{ ...fill, aspectRatio: `${width} / ${height}` }}
    />
  );
}
