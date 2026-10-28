"use client";

import { FILTER_PRESETS, isNeutral, presetFilters, type FilterValues } from "@vash/engine";
import { defaultFilters, type FrameNode } from "@vash/schema";
import { Button } from "@/components/ui/button";
import { ColorField, Row, Section, Slider, Switch } from "./fields";

type Update = (patch: Record<string, unknown>, final?: boolean) => void;

const SLIDERS: readonly { key: keyof FilterValues; label: string; signed: boolean }[] = [
  { key: "brightness", label: "Brightness", signed: true },
  { key: "contrast", label: "Contrast", signed: true },
  { key: "saturation", label: "Saturation", signed: true },
  { key: "warmth", label: "Warmth", signed: true },
  { key: "tint", label: "Tint", signed: true },
  { key: "highlights", label: "Highlights", signed: true },
  { key: "shadows", label: "Shadows", signed: true },
  { key: "vignette", label: "Vignette", signed: false },
  { key: "grain", label: "Grain", signed: false },
  { key: "blur", label: "Blur", signed: false },
  { key: "sharpen", label: "Sharpen", signed: false },
];

/** The colours a duotone starts with when the switch turns on. */
const DUOTONE_START = { light: "#F5E6C8", dark: "#2B2D42" };

/** `resetReason` is why "Reset adjustments" is off (null when it can run); `onReset` runs it. */
export function FiltersSection({ node, disabled, update, resetReason, onReset }: { node: FrameNode; disabled: boolean; update: Update; resetReason: string | null; onReset: () => void }) {
  const f = node.filters;
  const duotone = f.duotone ?? null;
  const chip = (selected: boolean) =>
    `h-8 rounded-lg px-2 text-[12px] font-medium disabled:opacity-45 ${selected ? "bg-text text-bg" : "bg-field text-text hover:bg-line"}`;

  return (
    <Section title="Filters">
      {!node.content && <p className="text-[12px] text-muted">Add a photo to this frame to see its filters.</p>}
      <div role="group" aria-label="Filter presets" className="grid grid-cols-4 gap-1.5">
        <button type="button" aria-pressed={f.preset === null && isNeutral(f)} disabled={disabled} onClick={() => update({ filters: defaultFilters() })} className={chip(f.preset === null && isNeutral(f))}>
          None
        </button>
        {FILTER_PRESETS.map((p) => (
          <button key={p.key} type="button" aria-pressed={f.preset === p.key} disabled={disabled} onClick={() => update({ filters: presetFilters(p.key) })} className={chip(f.preset === p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2.5 pt-1">
        {SLIDERS.map(({ key, label, signed }) => (
          <Slider
            key={key}
            label={label}
            value={f[key]}
            min={signed ? -1 : 0}
            max={1}
            disabled={disabled}
            // Adjusting by hand leaves the preset; its values stay as the starting point.
            onChange={(v, final) => update({ filters: { ...f, [key]: v, preset: null } }, final)}
          />
        ))}
        <Slider
          label="Pixelate"
          value={f.pixelate ?? 0}
          min={0}
          max={100}
          step={1}
          disabled={disabled}
          valueText={(v) => (v === 0 ? "Off" : String(Math.round(v)))}
          readout={(v) => String(Math.round(v))}
          onChange={(pixelate, final) => update({ filters: { ...f, pixelate, preset: null } }, final)}
        />
        <Row label="Duotone">
          <Switch
            label="Duotone"
            checked={duotone !== null}
            disabled={disabled}
            onChange={(on) => update({ filters: { ...f, duotone: on ? DUOTONE_START : null, preset: null } })}
          />
        </Row>
        {duotone && (
          <>
            <Row label="Light">
              <ColorField name="Light" value={duotone.light} disabled={disabled} onChange={(light, final) => update({ filters: { ...f, duotone: { ...duotone, light }, preset: null } }, final)} />
            </Row>
            <Row label="Dark">
              <ColorField name="Dark" value={duotone.dark} disabled={disabled} onChange={(dark, final) => update({ filters: { ...f, duotone: { ...duotone, dark }, preset: null } }, final)} />
            </Row>
          </>
        )}
        <div className="flex flex-col items-start gap-1.5">
          <Button variant="secondary" size="sm" disabled={resetReason !== null} onClick={onReset}>
            Reset adjustments
          </Button>
          {resetReason && <p className="text-[12px] text-muted">{resetReason}</p>}
        </div>
      </div>
    </Section>
  );
}
