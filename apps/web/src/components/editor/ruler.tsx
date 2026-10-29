import type { PointerEvent } from "react";
import type { Viewport } from "@vash/engine";
import { rulerTicks } from "@/lib/ruler-ticks";

export const RULER_THICKNESS = 20;

interface RulerProps {
  axis: "x" | "y";
  viewport: Viewport;
  /** Length of the canvas along this axis, in screen px. */
  length: number;
  /** The page in design units along this axis (0 to width, or 0 to height). */
  page: { start: number; end: number };
  /** Starts dragging a guide out of the ruler. */
  onGuideStart?: (e: PointerEvent) => void;
}

const T = RULER_THICKNESS;

export function Ruler({ axis, viewport, length, page, onGuideStart }: RulerProps) {
  const horizontal = axis === "x";
  const pan = horizontal ? viewport.panX : viewport.panY;
  const { major, minor } = rulerTicks({ start: 0, length, zoom: viewport.zoom, pan });

  const pageStart = Math.min(length, Math.max(0, page.start * viewport.zoom + pan));
  const pageEnd = Math.min(length, Math.max(0, page.end * viewport.zoom + pan));

  // Ticks run along the ruler's length. `along` is a screen position on that length, `across` is depth.
  const tick = (along: number, size: number) => {
    const p = Math.round(along) + 0.5;
    return horizontal
      ? { x1: p, x2: p, y1: T, y2: T - size }
      : { x1: T, x2: T - size, y1: p, y2: p };
  };
  const label = (along: number, text: string) =>
    horizontal ? (
      <text key={text} x={along + 3} y={13}>
        {text}
      </text>
    ) : (
      <text key={text} transform={`translate(12 ${along + 3}) rotate(-90)`} textAnchor="end">
        {text}
      </text>
    );

  const edge = horizontal ? { x1: 0, x2: length, y1: T - 0.5, y2: T - 0.5 } : { x1: T - 0.5, x2: T - 0.5, y1: 0, y2: length };

  return (
    <svg
      aria-hidden="true"
      width={horizontal ? length : T}
      height={horizontal ? T : length}
      className={`block flex-none bg-bg2 fill-muted text-[10px] tabular-nums select-none ${
        onGuideStart ? (horizontal ? "cursor-row-resize" : "cursor-col-resize") : ""
      }`}
      onPointerDown={onGuideStart}
    >
      <rect
        x={horizontal ? pageStart : 0}
        y={horizontal ? 0 : pageStart}
        width={horizontal ? pageEnd - pageStart : T}
        height={horizontal ? T : pageEnd - pageStart}
        style={{ fill: "var(--seg)" }}
      />
      <g className="stroke-muted" strokeWidth={1}>
        {minor.map((p) => (
          <line key={`m${p}`} {...tick(p, 5)} />
        ))}
        {major.map((t) => (
          <line key={`M${t.at}`} {...tick(t.screen, 10)} />
        ))}
      </g>
      {major.map((t) => label(t.screen, t.label))}
      <line {...edge} className="stroke-line" strokeWidth={1} />
    </svg>
  );
}
