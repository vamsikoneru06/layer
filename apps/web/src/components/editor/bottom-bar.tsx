"use client";

import type { Editor } from "@vash/engine";
import { CircleHelp, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { SLIDER_STEPS, sliderToZoom, zoomToSlider } from "@/lib/zoom-slider";
import type { Action, ActionId } from "./editor-actions";
import { IconButton } from "./icon-button";

export function BottomBar({ editor, zoom, size, actions }: { editor: Editor | null; zoom: number; size: { width: number; height: number }; actions: Record<ActionId, Action> | null }) {
  return (
    <footer className="flex h-10 flex-none items-center gap-1 border-t-[.5px] border-line px-3 text-[13px] text-muted">
      <IconButton label="Zoom out" onClick={() => actions?.zoomOut.run()} disabled={!actions || !!actions.zoomOut.disabled}>
        <ZoomOut aria-hidden />
      </IconButton>
      <input
        type="range"
        aria-label="Zoom"
        aria-valuetext={`${Math.round(zoom * 100)}%`}
        min={0}
        max={SLIDER_STEPS}
        value={zoomToSlider(zoom)}
        onChange={(e) => editor?.zoomTo(sliderToZoom(Number(e.target.value)))}
        className="h-4 w-32 cursor-pointer accent-(--text)"
      />
      <IconButton label="Zoom in" onClick={() => actions?.zoomIn.run()} disabled={!actions || !!actions.zoomIn.disabled}>
        <ZoomIn aria-hidden />
      </IconButton>
      <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={() => actions?.fit.run()} className="h-7 rounded-md px-2 font-medium text-text hover:bg-field">
        Fit
      </button>
      <div className="flex-1" />
      <span className="tabular-nums">
        {size.width} × {size.height}
      </span>
      {actions && !actions.fullscreen.hidden && (
        <IconButton label="Fullscreen" onClick={() => actions.fullscreen.run()}>
          <Maximize aria-hidden />
        </IconButton>
      )}
      <IconButton label="Keyboard shortcuts" onClick={() => actions?.shortcuts.run()} disabled={!actions}>
        <CircleHelp aria-hidden />
      </IconButton>
    </footer>
  );
}
