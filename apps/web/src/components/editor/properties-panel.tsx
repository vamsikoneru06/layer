"use client";

import { apply, checkPolicy, FILTER_PRESETS, isNeutral, presetFilters, rotation, type Command, type EditorCore, type EditorState, type FilterValues } from "@vash/engine";
import { defaultFilters, FONT_FAMILIES, LIMITS, type FrameNode, type Node, type ShapeNode, type TextNode } from "@vash/schema";
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  ArrowDown,
  ArrowUp,
  BringToFront,
  FlipHorizontal2,
  FlipVertical2,
  Lock,
  SendToBack,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { docColors } from "@/lib/color";
import { DocColorsContext } from "./color-picker";
import { ColorField, NumberField, Row, Section, Segmented, SelectField, Slider, Switch } from "./fields";
import { actionTitle, type Action, type ActionId } from "./editor-actions";
import { FillField } from "./fill-field";
import { FONT_FACES } from "./font-faces";
import { IconButton } from "./icon-button";

const TYPE_LABEL: Record<Node["type"], string> = { frame: "Photo frame", text: "Text", shape: "Shape", sticker: "Sticker", group: "Group" };

/**
 * Applies a change as one undo step. Colour pickers send a stream of previews (`final` false) then one
 * final value; those run as a single transaction, like a drag on the canvas.
 */
function changer(core: EditorCore) {
  return (cmd: Command, final = true) => {
    if (final && !core.history.inTransaction) return void core.dispatch(cmd);
    if (!core.history.inTransaction) core.beginTransaction();
    core.preview(cmd);
    if (final) core.commitTransaction();
  };
}

/** Nearest weight a family ships, so switching fonts never asks for a face that doesn't exist. */
function nearestWeight(family: string, weight: number): number {
  const weights = FONT_FACES[family]?.weights ?? [400];
  return weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), weights[0]!);
}

const WEIGHT_NAMES: Record<number, string> = { 100: "Thin", 200: "Extra light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra bold", 900: "Black" };

type Actions = Record<ActionId, Action>;

/** Icon buttons for the arrange actions, in rows by kind. Each one shows why it is off, or its name and shortcut, as its tooltip. */
const ARRANGE_ROWS: readonly { name: string; buttons: readonly { id: ActionId; icon: ReactNode }[] }[] = [
  {
    name: "Align",
    buttons: [
      { id: "alignLeft", icon: <AlignStartVertical aria-hidden /> },
      { id: "alignCenter", icon: <AlignCenterVertical aria-hidden /> },
      { id: "alignRight", icon: <AlignEndVertical aria-hidden /> },
      { id: "alignTop", icon: <AlignStartHorizontal aria-hidden /> },
      { id: "alignMiddle", icon: <AlignCenterHorizontal aria-hidden /> },
      { id: "alignBottom", icon: <AlignEndHorizontal aria-hidden /> },
    ],
  },
  {
    name: "Distribute and flip",
    buttons: [
      { id: "distributeHorizontal", icon: <AlignHorizontalSpaceBetween aria-hidden /> },
      { id: "distributeVertical", icon: <AlignVerticalSpaceBetween aria-hidden /> },
      { id: "flipHorizontal", icon: <FlipHorizontal2 aria-hidden /> },
      { id: "flipVertical", icon: <FlipVertical2 aria-hidden /> },
    ],
  },
  {
    name: "Order",
    buttons: [
      { id: "bringForward", icon: <ArrowUp aria-hidden /> },
      { id: "bringToFront", icon: <BringToFront aria-hidden /> },
      { id: "sendBackward", icon: <ArrowDown aria-hidden /> },
      { id: "sendToBack", icon: <SendToBack aria-hidden /> },
    ],
  },
];

function PositionSection({ actions, mac }: { actions: Actions; mac: boolean }) {
  return (
    <Section title="Position">
      <div className="flex flex-col gap-1">
        {ARRANGE_ROWS.map((row) => (
          <div key={row.name} role="group" aria-label={row.name} className="flex gap-1">
            {row.buttons.map(({ id, icon }) => {
              const a = actions[id];
              return (
                <IconButton key={id} label={a.label} title={actionTitle(a, mac)} onClick={a.run} disabled={!!a.disabled}>
                  {icon}
                </IconButton>
              );
            })}
          </div>
        ))}
      </div>
    </Section>
  );
}

/** `actions` feeds the Position buttons; a host without them (the filters lab) shows the panel without that section. */
export function PropertiesPanel({ state, core, actions, mac = false }: { state: EditorState; core: EditorCore; actions?: Actions; mac?: boolean }) {
  const colors = useMemo(() => docColors(state.doc), [state.doc]);
  return (
    <DocColorsContext value={colors}>
      <PanelBody state={state} core={core} actions={actions} mac={mac} />
    </DocColorsContext>
  );
}

function PanelBody({ state, core, actions, mac }: { state: EditorState; core: EditorCore; actions?: Actions; mac: boolean }) {
  const { doc, selection, mode } = state;
  const change = changer(core);
  const allowed = (cmd: Command) => checkPolicy(doc, cmd, mode).ok;

  if (selection.length > 1) {
    return (
      <div className="flex flex-col gap-3.5">
        <p className="text-muted">{selection.length} layers selected. Select one layer to edit its properties.</p>
        {actions && <PositionSection actions={actions} mac={mac} />}
      </div>
    );
  }

  const node = selection.length === 1 ? doc.nodes[selection[0]!] : undefined;
  if (!node) {
    const art = doc.artboard;
    const resizable = allowed({ type: "artboard", patch: { width: art.width } });
    return (
      <div className="flex flex-col gap-3.5">
        <Section title="Design">
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="W" name="Design width" value={art.width} min={LIMITS.artboardMin} max={LIMITS.artboardMax} disabled={!resizable} onCommit={(width) => change({ type: "artboard", patch: { width } })} />
            <NumberField label="H" name="Design height" value={art.height} min={LIMITS.artboardMin} max={LIMITS.artboardMax} disabled={!resizable} onCommit={(height) => change({ type: "artboard", patch: { height } })} />
          </div>
          {!resizable && <p className="text-[12px] text-muted">The template sets this design&apos;s size.</p>}
        </Section>
        <Section title="Background">
          <FillField name="Background" value={art.background} onChange={(background, final) => change({ type: "artboard", patch: { background } }, final)} />
        </Section>
      </div>
    );
  }

  const id = node.id;
  const update = (patch: Record<string, unknown>, final = true) => change({ type: "update", id, patch } as Command, final);
  const locked = mode === "design" && node.lock === "locked";
  const layoutLocked = mode === "design" && node.lock !== "free";
  const t = node.transform;

  // X/Y are the top-left of the layer's unrotated box, as in most design tools; the document stores its centre.
  const w = node.width * t.scaleX;
  const h = node.height * t.scaleY;
  const resize = (dim: "width" | "height", size: number) => {
    // Keep the top-left corner in place: move the centre by half the change, along the layer's rotation.
    const dw = dim === "width" ? (size - node.width) * t.scaleX : 0;
    const dh = dim === "height" ? (size - node.height) * t.scaleY : 0;
    const shift = apply(rotation(t.rotation), { x: dw / 2, y: dh / 2 });
    update({ [dim]: size, transform: { ...t, x: t.x + shift.x, y: t.y + shift.y } });
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[14px] font-semibold">{TYPE_LABEL[node.type]}</span>
        {node.lock !== "free" && (
          <span className="flex flex-none items-center gap-1 rounded-md bg-field px-2 py-0.5 text-[12px] text-muted">
            <Lock aria-hidden className="size-3" />
            {node.lock === "locked" ? "Locked" : "Content only"}
          </span>
        )}
      </div>

      {locked && (
        <div className="flex flex-col gap-2 rounded-lg bg-bg2 p-3 text-[12px] text-muted">
          This layer is locked, so it can&apos;t be changed. Unlock it to edit.
          <Button variant="secondary" size="sm" onClick={() => update({ lock: "free" })}>
            Unlock layer
          </Button>
        </div>
      )}

      {node.type === "text" && <TextSection node={node} disabled={locked} update={update} />}
      {node.type === "shape" && <ShapeSection node={node} disabled={locked} update={update} />}
      {node.type === "frame" && <FiltersSection node={node} disabled={locked} update={update} />}

      {actions && <PositionSection actions={actions} mac={mac} />}

      <Section title="Position & size">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" name="X position" value={t.x - w / 2} disabled={layoutLocked} onCommit={(x) => update({ transform: { ...t, x: x + w / 2 } })} />
          <NumberField label="Y" name="Y position" value={t.y - h / 2} disabled={layoutLocked} onCommit={(y) => update({ transform: { ...t, y: y + h / 2 } })} />
          <NumberField label="W" name="Width" value={node.width} min={1} max={LIMITS.coordinate} disabled={layoutLocked || node.type === "group"} onCommit={(v) => resize("width", v)} />
          <NumberField label="H" name="Height" value={node.height} min={1} max={LIMITS.coordinate} disabled={layoutLocked || node.type === "group"} onCommit={(v) => resize("height", v)} />
          <NumberField
            label="↻"
            name="Rotation in degrees"
            value={t.rotation}
            suffix="°"
            digits={1}
            disabled={layoutLocked}
            onCommit={(r) => update({ transform: { ...t, rotation: ((((r + 180) % 360) + 360) % 360) - 180 } })}
          />
          <NumberField label="◐" name="Opacity in percent" value={node.opacity * 100} min={0} max={100} suffix="%" disabled={locked} onCommit={(o) => update({ opacity: o / 100 })} />
        </div>
      </Section>

      {mode === "design" && !locked && (
        <Row label="Lock layer">
          <Switch label="Lock layer" checked={node.lock !== "free"} onChange={(on) => update({ lock: on ? "locked" : "free" })} />
        </Row>
      )}
    </div>
  );
}

type Update = (patch: Record<string, unknown>, final?: boolean) => void;

const ALIGN = [
  { value: "left", label: "Align left", icon: <AlignLeft aria-hidden /> },
  { value: "center", label: "Align centre", icon: <AlignCenter aria-hidden /> },
  { value: "right", label: "Align right", icon: <AlignRight aria-hidden /> },
  { value: "justify", label: "Justify", icon: <AlignJustify aria-hidden /> },
] as const;

function TextSection({ node, disabled, update }: { node: TextNode; disabled: boolean; update: Update }) {
  const face = FONT_FACES[node.font.family] ?? { weights: [400], italic: false };
  const setFont = (patch: Partial<TextNode["font"]>) => {
    const font = { ...node.font, ...patch };
    font.weight = nearestWeight(font.family, font.weight);
    if (font.style === "italic" && !FONT_FACES[font.family]?.italic) font.style = "normal";
    update({ font });
  };

  return (
    <Section title="Text">
      <SelectField name="Font" value={node.font.family} disabled={disabled} onChange={(family) => setFont({ family })} style={{ fontFamily: `"${node.font.family}"` }}>
        {FONT_FAMILIES.map((f) => (
          <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
            {f}
          </option>
        ))}
      </SelectField>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <SelectField name="Weight" value={String(node.font.weight)} disabled={disabled || face.weights.length < 2} onChange={(v) => setFont({ weight: Number(v) })}>
          {face.weights.map((wt) => (
            <option key={wt} value={wt}>
              {WEIGHT_NAMES[wt] ?? wt}
            </option>
          ))}
        </SelectField>
        <Segmented
          name="Style"
          value={node.font.style}
          disabled={disabled || !face.italic}
          options={[
            { value: "normal", label: "Regular" },
            { value: "italic", label: "Italic" },
          ]}
          onChange={(style) => setFont({ style })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Aa" name="Font size" value={node.size} min={LIMITS.fontSizeMin} max={LIMITS.fontSizeMax} digits={1} disabled={disabled} onCommit={(size) => update({ size })} />
        <ColorField name="Text" value={node.color} disabled={disabled} onChange={(color, final) => update({ color }, final)} />
      </div>
      <Segmented name="Alignment" value={node.align} options={ALIGN} disabled={disabled} onChange={(align) => update({ align })} />
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="↕" name="Line height" value={node.lineHeight} min={0.5} max={5} step={0.05} digits={2} disabled={disabled} onCommit={(lineHeight) => update({ lineHeight })} />
        <NumberField label="↔" name="Letter spacing" value={node.letterSpacing} min={-100} max={500} step={0.5} digits={1} disabled={disabled} onCommit={(letterSpacing) => update({ letterSpacing })} />
      </div>
      <Row label="Shrink text to fit">
        <Switch label="Shrink text to fit" checked={node.fit === "shrink"} disabled={disabled} onChange={(on) => update({ fit: on ? "shrink" : "none" })} />
      </Row>
    </Section>
  );
}

function ShapeSection({ node, disabled, update }: { node: ShapeNode; disabled: boolean; update: Update }) {
  const g = node.geometry;
  return (
    <Section title="Shape">
      <Row label="Fill">
        {node.fill ? (
          <button type="button" disabled={disabled} onClick={() => update({ fill: null })} className="px-1 text-[13px] text-muted hover:text-text disabled:opacity-45">
            Remove
          </button>
        ) : (
          <button type="button" disabled={disabled} onClick={() => update({ fill: { type: "solid", color: "#D9D9D9" } })} className="text-[13px] font-medium hover:underline disabled:opacity-45">
            Add fill
          </button>
        )}
      </Row>
      {node.fill && <FillField name="Fill" value={node.fill} disabled={disabled} onChange={(fill, final) => update({ fill }, final)} />}
      <Row label="Stroke">
        {node.stroke ? (
          <div className="flex w-[150px] items-center gap-1">
            <ColorField name="Stroke" value={node.stroke.color} disabled={disabled} onChange={(color, final) => update({ stroke: { ...node.stroke!, color } }, final)} />
          </div>
        ) : (
          <button type="button" disabled={disabled} onClick={() => update({ stroke: { color: "#1D1D1F", width: 2 } })} className="text-[13px] font-medium hover:underline disabled:opacity-45">
            Add stroke
          </button>
        )}
      </Row>
      {node.stroke && (
        <div className="grid grid-cols-[1fr_auto] items-center gap-2">
          <NumberField label="W" name="Stroke width" value={node.stroke.width} min={0} max={LIMITS.strokeWidthMax} step={0.5} digits={1} disabled={disabled} onCommit={(width) => update({ stroke: { ...node.stroke!, width } })} />
          <button type="button" disabled={disabled} onClick={() => update({ stroke: null })} className="px-1 text-[13px] text-muted hover:text-text disabled:opacity-45">
            Remove
          </button>
        </div>
      )}
      {g.kind === "rect" && (
        <NumberField
          label="◜"
          name="Corner radius"
          value={g.cornerRadius}
          min={0}
          max={LIMITS.coordinate}
          disabled={disabled}
          onCommit={(cornerRadius) => update({ geometry: { ...g, cornerRadius } })}
        />
      )}
    </Section>
  );
}

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

function FiltersSection({ node, disabled, update }: { node: FrameNode; disabled: boolean; update: Update }) {
  const f = node.filters;
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
      </div>
    </Section>
  );
}
