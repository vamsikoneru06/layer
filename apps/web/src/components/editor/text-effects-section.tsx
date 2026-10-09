"use client";

import { LIMITS, type TextList, type TextNode } from "@vash/schema";
import { parseHex } from "@/lib/color";
import { ColorField, Row, Section, Segmented, Slider, Switch } from "./fields";

/** The highlight a layer gets when switched on: a soft yellow, like a marker. */
const DEFAULT_HIGHLIGHT = "#FFE066";
/** The outline width a layer gets when switched on, in px. */
const DEFAULT_OUTLINE_WIDTH = 3;

const LIST_OPTIONS: readonly { value: TextList; label: string }[] = [
  { value: "none", label: "None" },
  { value: "bullet", label: "Bullets" },
  { value: "number", label: "Numbers" },
];

/** White behind dark text, black behind light text, judged by perceived brightness (Rec. 601 weights). */
export function outlineColorFor(text: string): string {
  const c = parseHex(text);
  if (!c) return "#000000";
  const brightness = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  return brightness < 0.5 ? "#FFFFFF" : "#000000";
}

/** Outline, highlight and list for a text layer. Each switch starts with a sensible look and removes the field when off. */
export function TextEffectsSection({ node, disabled, update }: { node: TextNode; disabled: boolean; update: (patch: Record<string, unknown>, final?: boolean) => void }) {
  const o = node.outline;
  const h = node.highlight;
  return (
    <Section title="Effects">
      <Row label="Outline">
        <Switch label="Outline" checked={!!o} disabled={disabled} onChange={(on) => update({ outline: on ? { color: outlineColorFor(node.color), width: DEFAULT_OUTLINE_WIDTH } : null })} />
      </Row>
      {o && (
        <>
          <ColorField name="Outline" value={o.color} disabled={disabled} onChange={(color, final) => update({ outline: { ...o, color } }, final)} />
          <Slider
            label="Width"
            value={o.width}
            min={1}
            max={LIMITS.textOutlineMax}
            step={1}
            disabled={disabled}
            readout={(v) => String(Math.round(v))}
            valueText={(v) => `${Math.round(v)} pixels`}
            onChange={(width, final) => update({ outline: { ...o, width } }, final)}
          />
        </>
      )}
      <Row label="Highlight">
        <Switch label="Highlight" checked={!!h} disabled={disabled} onChange={(on) => update({ highlight: on ? { color: DEFAULT_HIGHLIGHT } : null })} />
      </Row>
      {h && <ColorField name="Highlight" value={h.color} disabled={disabled} onChange={(color, final) => update({ highlight: { color } }, final)} />}
      <Segmented name="List" value={node.list ?? "none"} options={LIST_OPTIONS} disabled={disabled} onChange={(list) => update({ list })} />
    </Section>
  );
}
