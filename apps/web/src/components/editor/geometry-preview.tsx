import type { ShapeGeometry } from "@vash/schema";
import { fitBox, polygonUnitPoints } from "@/lib/element-helpers";

/** The Tile's svg is 48 by 48; the drawing fills 40 of it along its longer side. */
const TILE = 48;
const DRAWN = 40;

/**
 * The SVG drawing of a catalogue entry, for use inside a Tile's svg. It is centred and keeps the entry's
 * proportions. Filled shapes get a soft fill; lines and icons are outlines with a thin, fixed-width stroke.
 */
export function GeometryPreview({
  geometry,
  width,
  height,
  filled,
}: {
  geometry: ShapeGeometry;
  width: number;
  height: number;
  filled: boolean;
}) {
  const box = fitBox(width, height, DRAWN);
  const x = (TILE - box.width) / 2;
  const y = (TILE - box.height) / 2;
  const scale = box.width / width;
  const ink = filled
    ? { fill: "currentColor", opacity: 0.35 }
    : { fill: "none", stroke: "currentColor", strokeWidth: 1.5, vectorEffect: "non-scaling-stroke" };

  if (geometry.kind === "rect") {
    const r = Math.min(geometry.cornerRadius * scale, box.width / 2, box.height / 2);
    return <rect x={x} y={y} width={box.width} height={box.height} rx={r} {...ink} />;
  }
  if (geometry.kind === "ellipse") {
    return <ellipse cx={TILE / 2} cy={TILE / 2} rx={box.width / 2} ry={box.height / 2} {...ink} />;
  }
  if (geometry.kind === "polygon") {
    const points = polygonUnitPoints(geometry.sides)
      .map(([px, py]) => `${x + px * box.width},${y + py * box.height}`)
      .join(" ");
    return <polygon points={points} {...ink} />;
  }
  return (
    <svg x={x} y={y} width={box.width} height={box.height} viewBox="0 0 1 1" preserveAspectRatio="none" overflow="visible">
      <path d={geometry.d} {...ink} />
    </svg>
  );
}
