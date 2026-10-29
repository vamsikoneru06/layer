"use client";

import { GUIDE_COLOR, type Viewport } from "@vash/engine";
import { useRef, useState, type PointerEvent } from "react";
import { type GuideAxis, type Guides, toDesign, toScreen } from "@/lib/guides";

/** A spacing marker in design px, structurally the same as the engine's `SpacingIndicator`. */
export interface SpacingLine {
  axis: GuideAxis;
  from: number;
  to: number;
  at: number;
}

export interface CanvasOverlayProps {
  viewport: Viewport;
  /** Canvas element size in screen px. */
  size: { width: number; height: number };
  /** Artboard size in design px. The artboard starts at design (0, 0). */
  page: { width: number; height: number };
  guides: Guides;
  showGuides: boolean;
  showGrid: boolean;
  showSafeArea: boolean;
  showMargins: boolean;
  /** Equal-spacing markers shown while dragging a layer. */
  spacing?: SpacingLine[];
  onMoveGuide: (axis: GuideAxis, index: number, at: number) => void;
  onRemoveGuide: (axis: GuideAxis, index: number) => void;
}

interface Drag {
  x: number;
  y: number;
  at: number;
}

const GRID_MAJOR = 50;
const GRID_MINOR = 10;
const HIT_WIDTH = 8;
/** Half the length of the tick caps on a spacing marker, in screen px. */
const SPACING_TICK = 4;

/** Multiples of `step` between `start` and `end`, inclusive. */
function multiples(step: number, start: number, end: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(start / step) * step; v <= end; v += step) out.push(v);
  return out;
}

export function CanvasOverlay({ viewport, size, page, guides, showGuides, showGrid, showSafeArea, showMargins, spacing = [], onMoveGuide, onRemoveGuide }: CanvasOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const { zoom, panX, panY } = viewport;

  // The page area on screen, clipped to the canvas.
  const left = Math.max(0, toScreen(0, zoom, panX));
  const right = Math.min(size.width, toScreen(page.width, zoom, panX));
  const top = Math.max(0, toScreen(0, zoom, panY));
  const bottom = Math.min(size.height, toScreen(page.height, zoom, panY));

  // Design range that is both on the page and on screen, so only visible grid lines are built.
  const minX = Math.max(0, toDesign(0, zoom, panX));
  const maxX = Math.min(page.width, toDesign(size.width, zoom, panX));
  const minY = Math.max(0, toDesign(0, zoom, panY));
  const maxY = Math.min(page.height, toDesign(size.height, zoom, panY));

  const showMinor = GRID_MINOR * zoom >= 8;
  const major = { x: multiples(GRID_MAJOR, minX, maxX), y: multiples(GRID_MAJOR, minY, maxY) };
  const minor = showMinor
    ? {
        x: multiples(GRID_MINOR, minX, maxX).filter((v) => v % GRID_MAJOR !== 0),
        y: multiples(GRID_MINOR, minY, maxY).filter((v) => v % GRID_MAJOR !== 0),
      }
    : { x: [], y: [] };

  const linesPath = (axis: GuideAxis, designs: number[]) =>
    designs
      .map((v) => {
        if (axis === "x") {
          const x = Math.round(toScreen(v, zoom, panX)) + 0.5;
          return `M${x} ${top}V${bottom}`;
        }
        const y = Math.round(toScreen(v, zoom, panY)) + 0.5;
        return `M${left} ${y}H${right}`;
      })
      .join("");

  const gridPath = (lines: { x: number[]; y: number[] }) => linesPath("x", lines.x) + linesPath("y", lines.y);

  // A spacing marker: a line between two edges with a tick cap at each end, in screen px.
  const spacingPath = (s: SpacingLine) => {
    const horizontal = s.axis === "x";
    const edge = (v: number) => Math.round(toScreen(v, zoom, horizontal ? panX : panY)) + 0.5;
    const across = Math.round(toScreen(s.at, zoom, horizontal ? panY : panX)) + 0.5;
    const a = edge(Math.min(s.from, s.to));
    const b = edge(Math.max(s.from, s.to));
    const cap = (v: number) => (horizontal ? `M${v} ${across - SPACING_TICK}V${across + SPACING_TICK}` : `M${across - SPACING_TICK} ${v}H${across + SPACING_TICK}`);
    const line = horizontal ? `M${a} ${across}H${b}` : `M${across} ${a}V${b}`;
    return `${line}${cap(a)}${cap(b)}`;
  };

  // A rectangle inset by `fraction` of the page on every side, in screen px, on whole pixels so the dashes stay crisp.
  const insetBox = (fraction: number) => {
    const x1 = Math.round(toScreen(page.width * fraction, zoom, panX)) + 0.5;
    const x2 = Math.round(toScreen(page.width * (1 - fraction), zoom, panX)) + 0.5;
    const y1 = Math.round(toScreen(page.height * fraction, zoom, panY)) + 0.5;
    const y2 = Math.round(toScreen(page.height * (1 - fraction), zoom, panY)) + 0.5;
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  };

  const localPoint = (e: PointerEvent<SVGLineElement>) => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const begin = (e: PointerEvent<SVGLineElement>, at: number) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    setDrag({ x: p.x, y: p.y, at });
  };

  // Outside the canvas (over its ruler) the guide stays where it last was. Released there, it is removed.
  const track = (e: PointerEvent<SVGLineElement>, axis: GuideAxis, index: number) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const p = localPoint(e);
    const along = axis === "x" ? p.x : p.y;
    if (along < 0) return;
    const at = toDesign(along, zoom, axis === "x" ? panX : panY);
    setDrag({ x: p.x, y: p.y, at });
    onMoveGuide(axis, index, at);
  };

  const finish = (e: PointerEvent<SVGLineElement>, axis: GuideAxis, index: number) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const p = localPoint(e);
    setDrag(null);
    if ((axis === "x" ? p.x : p.y) < 0) onRemoveGuide(axis, index);
  };

  const guideLine = (axis: GuideAxis, index: number, designAt: number) => {
    const screenAt = toScreen(designAt, zoom, axis === "x" ? panX : panY);
    const crisp = Math.round(screenAt) + 0.5;
    const visible = axis === "x" ? { x1: crisp, x2: crisp, y1: 0, y2: size.height } : { x1: 0, x2: size.width, y1: crisp, y2: crisp };
    const hit = axis === "x" ? { x1: screenAt, x2: screenAt, y1: 0, y2: size.height } : { x1: 0, x2: size.width, y1: screenAt, y2: screenAt };
    return (
      <g key={`${axis}-${index}`}>
        <line {...visible} strokeWidth={1} stroke={GUIDE_COLOR} />
        <line
          {...hit}
          strokeWidth={HIT_WIDTH}
          stroke="transparent"
          className="pointer-events-auto"
          style={{ cursor: axis === "x" ? "ew-resize" : "ns-resize", touchAction: "none" }}
          onPointerDown={(e) => begin(e, designAt)}
          onPointerMove={(e) => track(e, axis, index)}
          onPointerUp={(e) => finish(e, axis, index)}
          onPointerCancel={() => setDrag(null)}
        />
      </g>
    );
  };

  return (
    <div ref={rootRef} className="pointer-events-none absolute top-0 left-0 overflow-hidden" style={{ width: size.width, height: size.height }}>
      <svg width={size.width} height={size.height} className="absolute top-0 left-0 block" aria-hidden="true">
        {showGrid && (
          <g fill="none">
            <path d={gridPath(minor)} style={{ stroke: "var(--muted)" }} strokeOpacity={0.12} />
            <path d={gridPath(major)} style={{ stroke: "var(--muted)" }} strokeOpacity={0.28} />
          </g>
        )}
        {showSafeArea && <rect {...insetBox(0.1)} fill="none" strokeWidth={1} strokeDasharray="1 3" strokeLinecap="round" style={{ stroke: "var(--line)" }} />}
        {showMargins && <rect {...insetBox(0.05)} fill="none" strokeWidth={1} strokeDasharray="4 3" style={{ stroke: "var(--muted)" }} />}
        {showGuides && (
          <g>
            {guides.x.map((at, i) => guideLine("x", i, at))}
            {guides.y.map((at, i) => guideLine("y", i, at))}
          </g>
        )}
        {spacing.length > 0 && <path d={spacing.map(spacingPath).join("")} fill="none" strokeWidth={1} stroke={GUIDE_COLOR} />}
      </svg>
      {drag && (
        <div
          className="pointer-events-none absolute rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums bg-[var(--bg)] text-[var(--text)] shadow-[inset_0_0_0_1px_var(--line)]"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {Math.round(drag.at)}
        </div>
      )}
    </div>
  );
}
