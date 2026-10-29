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
const brightness = (hex: string): number | null => {
  const c = parseHex(hex);
  return c ? (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 : null;
};

/**
 * The opposite of the text colour, so the outline stands out around the letters. When that would vanish into the
 * page (a white outline on a white page), a mid grey that shows on both light and dark is used instead.
 */
export function outlineColorFor(text: string, page: string | null = null): string {
  const t = brightness(text);
  const outline = t === null || t >= 0.5 ? "#000000" : "#FFFFFF";
  const p = page === null ? null : brightness(page);
  if (p !== null && Math.abs(p - (outline === "#FFFFFF" ? 1 : 0)) < 0.2) return "#8E8E93";
  return outline;
}

/** Outline, highlight, list and curve for a text layer. Each switch starts with a sensible look and removes the field when off. */
export function TextEffectsSection({ node, page, disabled, update }: { node: TextNode; page: string | null; disabled: boolean; update: (patch: Record<string, unknown>, final?: boolean) => void }) {
  const o = node.outline;
  const h = node.highlight;
  const curve = node.curve ?? 0;
  // The highlight band is drawn behind straight lines only, so it is switched off while the text is curved.
  const curved = curve !== 0;
  return (
    <Section title="Effects">
      <Row label="Outline">
        <Switch label="Outline" checked={!!o} disabled={disabled} onChange={(on) => update({ outline: on ? { color: outlineColorFor(node.color, page), width: DEFAULT_OUTLINE_WIDTH } : null })} />
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
        <Switch label="Highlight" checked={!!h} disabled={disabled || curved} onChange={(on) => update({ highlight: on ? { color: DEFAULT_HIGHLIGHT } : null })} />
      </Row>
      {curved && <p className="text-[12px] text-muted">Highlight works on straight text.</p>}
      {h && <ColorField name="Highlight" value={h.color} disabled={disabled || curved} onChange={(color, final) => update({ highlight: { color } }, final)} />}
      <Segmented name="List" value={node.list ?? "none"} options={LIST_OPTIONS} disabled={disabled} onChange={(list) => update({ list })} />
      <Slider
        label="Curve"
        value={curve}
        min={-LIMITS.curveMax}
        max={LIMITS.curveMax}
        step={1}
        disabled={disabled}
        readout={(v) => String(Math.round(v))}
        valueText={(v) => (Math.round(v) === 0 ? "Straight" : Math.round(v) > 0 ? `Arch ${Math.round(v)}` : `Smile ${-Math.round(v)}`)}
        onChange={(value, final) => update({ curve: value }, final)}
      />
    </Section>
  );
}
