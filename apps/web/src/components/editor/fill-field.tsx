"use client";

import { LIMITS, type Fill } from "@vash/schema";
import { Plus, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addStop, convertFill, fillCss, sortStops } from "@/lib/color";
import { ColorField, NumberField, Row, Segmented } from "./fields";

const TYPES: readonly { value: Fill["type"]; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "linear", label: "Linear" },
];

/** Offered only where a photo can be set (the artboard background). */
const IMAGE_TYPE = { value: "image", label: "Image" } as const;

/**
 * Edits a fill: one colour, a linear gradient (angle plus 2 to 8 stops), or a photo. Colour drags stream
 * `final: false` previews like ColorField; every other change is final. Choosing Image calls `onPickImage`,
 * which picks and sets the photo; a photo is removed with "Remove image", which returns to a white solid.
 */
export function FillField({ name, value, onChange, disabled, onPickImage }: {
  name: string;
  value: Fill;
  onChange: (fill: Fill, final: boolean) => void;
  disabled?: boolean;
  onPickImage?: () => void;
}) {
  const options = onPickImage ? [...TYPES, IMAGE_TYPE] : TYPES;
  return (
    <div className="flex flex-col gap-2">
      <Segmented
        name={`${name} type`}
        value={value.type}
        options={options}
        disabled={disabled}
        onChange={(type) => {
          if (type === "image") onPickImage?.();
          else onChange(convertFill(value, type), true);
        }}
      />
      {value.type === "solid" && (
        <ColorField name={name} value={value.color} disabled={disabled} onChange={(color, final) => onChange({ type: "solid", color }, final)} />
      )}
      {value.type === "linear" && <Linear name={name} fill={value} disabled={disabled} onChange={onChange} />}
      {value.type === "image" && (
        <div className="flex flex-col gap-2">
          <div aria-hidden className="h-6 rounded-lg shadow-[inset_0_0_0_.5px_var(--line)]" style={{ background: fillCss(value) }} />
          <p className="text-[12px] text-muted">The photo covers the design. Remove it to go back to a solid colour.</p>
          <Button variant="secondary" size="sm" disabled={disabled} onClick={() => onChange(convertFill(value, "solid"), true)} className="self-start">
            Remove image
          </Button>
        </div>
      )}
    </div>
  );
}

function Linear({ name, fill, onChange, disabled }: { name: string; fill: Extract<Fill, { type: "linear" }>; onChange: (fill: Fill, final: boolean) => void; disabled?: boolean }) {
  const set = (patch: Partial<typeof fill>, final = true) => onChange({ ...fill, ...patch }, final);
  const setStop = (i: number, patch: Partial<(typeof fill.stops)[number]>, final = true) =>
    set({ stops: fill.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) }, final);

  return (
    <>
      <div aria-hidden className="h-6 rounded-lg shadow-[inset_0_0_0_.5px_var(--line)]" style={{ background: fillCss({ ...fill, angle: 90 }) }} />
      <Row label="Angle">
        <div className="w-[96px]">
          <NumberField label={<RotateCw aria-hidden className="size-3" />} name={`${name} gradient angle`} value={fill.angle} min={-360} max={360} suffix="°" disabled={disabled} onCommit={(angle) => set({ angle })} />
        </div>
      </Row>
      <ol className="flex flex-col gap-1.5" aria-label={`${name} gradient stops`}>
        {fill.stops.map((stop, i) => (
          <li key={i} className="grid grid-cols-[1fr_72px_24px] items-center gap-1.5">
            <ColorField name={`${name} stop ${i + 1}`} value={stop.color} disabled={disabled} onChange={(color, final) => setStop(i, { color }, final)} />
            <NumberField
              label="%"
              name={`${name} stop ${i + 1} position`}
              value={Math.round(stop.offset * 100)}
              min={0}
              max={100}
              disabled={disabled}
              onCommit={(pct) => set({ stops: sortStops(fill.stops.map((s, j) => (j === i ? { ...s, offset: pct / 100 } : s))) })}
            />
            <button
              type="button"
              aria-label={`Remove ${name.toLowerCase()} stop ${i + 1}`}
              disabled={disabled || fill.stops.length <= 2}
              onClick={() => set({ stops: fill.stops.filter((_, j) => j !== i) })}
              className="grid size-6 place-items-center rounded-md text-muted transition hover:bg-field hover:text-text active:scale-90 disabled:opacity-30"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </li>
        ))}
      </ol>
      {fill.stops.length < LIMITS.gradientStops && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => set({ stops: addStop(fill.stops) })}
          className="flex items-center gap-1 self-start text-[13px] font-medium hover:underline disabled:opacity-45"
        >
          <Plus aria-hidden className="size-3.5" />
          Add stop
        </button>
      )}
    </>
  );
}
