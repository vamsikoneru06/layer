/**
 * Tick maths for the rulers. Design units map to screen pixels the same way as the engine's viewport:
 * screen = design * zoom + pan (see `toScreen` in packages/engine/src/viewport.ts).
 */

export interface RulerMajorTick {
  /** Design units (always a whole number). */
  at: number;
  /** Position along the ruler, in screen px, in the same frame as `start`. */
  screen: number;
  label: string;
}

export interface RulerTicks {
  major: RulerMajorTick[];
  /** Screen px positions of minor ticks, excluding any that fall on a major tick. */
  minor: number[];
}

export interface RulerTicksInput {
  /** Start of the visible span along the axis, in screen px. */
  start: number;
  /** Length of the visible span, in screen px. */
  length: number;
  zoom: number;
  /** Pan along this axis, in screen px (panX or panY). */
  pan: number;
  minLabelPx?: number;
}

const MANTISSAS = [1, 2, 5] as const;

/** The smallest step (1, 2 or 5 times a power of ten, never below 1 design px) whose labels are at least `minLabelPx` apart. */
export function rulerStep(zoom: number, minLabelPx: number): number {
  for (let decade = 1; ; decade *= 10) {
    for (const m of MANTISSAS) {
      const step = m * decade;
      if (step * zoom >= minLabelPx) return step;
    }
  }
}

export function rulerTicks({ start, length, zoom, pan, minLabelPx = 60 }: RulerTicksInput): RulerTicks {
  const empty: RulerTicks = { major: [], minor: [] };
  if (![start, length, zoom, pan, minLabelPx].every(Number.isFinite) || zoom <= 0 || length <= 0) return empty;

  const step = rulerStep(zoom, minLabelPx);
  // Minor ticks split a major step into 5, or into 2 when the major step is 2.
  const ratio = step === 2 ? 2 : 5;

  const a = (start - pan) / zoom;
  const b = (start + length - pan) / zoom;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);

  const major: RulerMajorTick[] = [];
  for (let i = Math.ceil(lo / step); i * step <= hi; i++) {
    const at = i * step;
    major.push({ at, screen: at * zoom + pan, label: String(at) });
  }

  // Minor index j is in units of step / ratio; skip the indices that land on a major tick.
  const minor: number[] = [];
  for (let j = Math.ceil((lo * ratio) / step); (j * step) / ratio <= hi; j++) {
    if (j % ratio === 0) continue;
    minor.push(((j * step) / ratio) * zoom + pan);
  }

  return { major, minor };
}
