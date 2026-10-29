"use client";

import { LIMITS, type Node, type Shadow } from "@vash/schema";
import { ColorField, NumberField, Row, Section, Slider, Switch } from "./fields";

/** What a layer gets when its shadow is switched on: a soft shadow, 25% black, a little below the layer. */
const DEFAULT_SHADOW: Shadow = { color: "#00000040", blur: 24, offsetX: 0, offsetY: 8 };

/** A drop shadow for any layer. The colour field keeps the alpha, so opacity is set in its picker. */
export function ShadowSection({ node, disabled, update }: { node: Node; disabled: boolean; update: (patch: Record<string, unknown>, final?: boolean) => void }) {
  const s = node.shadow;
  return (
    <Section title="Shadow">
      <Row label="Show shadow">
        <Switch label="Shadow" checked={!!s} disabled={disabled} onChange={(on) => update({ shadow: on ? { ...DEFAULT_SHADOW } : null })} />
      </Row>
      {s && (
        <>
          <ColorField name="Shadow" value={s.color} disabled={disabled} onChange={(color, final) => update({ shadow: { ...s, color } }, final)} />
          <Slider
            label="Blur"
            value={s.blur}
            min={0}
            max={LIMITS.shadowBlurMax}
            step={1}
            disabled={disabled}
            readout={(v) => String(Math.round(v))}
            valueText={(v) => `${Math.round(v)} pixels`}
            onChange={(blur, final) => update({ shadow: { ...s, blur } }, final)}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="X"
              name="Shadow X offset"
              value={s.offsetX}
              min={-LIMITS.shadowOffsetMax}
              max={LIMITS.shadowOffsetMax}
              disabled={disabled}
              onCommit={(offsetX) => update({ shadow: { ...s, offsetX } })}
            />
            <NumberField
              label="Y"
              name="Shadow Y offset"
              value={s.offsetY}
              min={-LIMITS.shadowOffsetMax}
              max={LIMITS.shadowOffsetMax}
              disabled={disabled}
              onCommit={(offsetY) => update({ shadow: { ...s, offsetY } })}
            />
          </div>
        </>
      )}
    </Section>
  );
}
