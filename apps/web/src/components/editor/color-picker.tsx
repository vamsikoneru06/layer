"use client";

import { Pipette } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { hsvToHex, parseHex, toHsv, type Hsv } from "@/lib/color";
import { cn } from "@/lib/utils";

/** Colours already in the design, offered at the bottom of every picker. */
export const DocColorsContext = createContext<string[]>([]);

const SWATCHES = ["#FFFFFF", "#D9D9D9", "#8E8E93", "#1D1D1F", "#E5484D", "#F76B15", "#FFC53D", "#30A46C", "#12A594", "#0090FF", "#3E63DD", "#D6409F"];

const CHECKER = "repeating-conic-gradient(#c8c8c8 0 25%, #fff 0 50%) 0 0 / 8px 8px";

type EyeDropperApi = { open: () => Promise<{ sRGBHex: string }> };
const eyeDropper = () => (typeof window !== "undefined" && "EyeDropper" in window ? (window as unknown as { EyeDropper: new () => EyeDropperApi }).EyeDropper : null);

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The colour editor inside a ColorField popover: saturation/brightness square, hue and opacity
 * sliders, a hex field, the design's colours, a few swatches and (where the browser has one) an
 * eyedropper. Drags stream `final: false` previews and end with one `final: true`, so a whole drag
 * is a single undo step.
 */
export function ColorPicker({ value, onChange, name }: { value: string; onChange: (color: string, final: boolean) => void; name: string }) {
  const docColors = useContext(DocColorsContext);
  const [hsv, setHsv] = useState<Hsv>(() => toHsv(value) ?? { h: 0, s: 0, v: 0, a: 1 });
  const emitted = useRef(value);
  const [hexDraft, setHexDraft] = useState<string | null>(null);

  // Follow outside changes (undo, another layer) without losing the hue of greys.
  useEffect(() => {
    if (value.toUpperCase() === emitted.current.toUpperCase()) return;
    emitted.current = value;
    setHsv((cur) => toHsv(value, cur.h) ?? cur);
  }, [value]);

  const emit = (next: Hsv, final: boolean) => {
    setHsv(next);
    const hex = hsvToHex(next);
    emitted.current = hex;
    onChange(hex, final);
  };

  const pick = (hex: string) => {
    const next = toHsv(hex, hsv.h);
    if (next) emit(next, true);
  };

  const hex = hsvToHex(hsv);
  const opaque = hsvToHex({ ...hsv, a: 1 });

  return (
    <div className="flex w-[232px] flex-col gap-3">
      <Area hsv={hsv} onChange={emit} name={name} />
      <Track
        label={`${name} hue`}
        value={hsv.h}
        max={360}
        background="linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
        thumb={hsvToHex({ h: hsv.h, s: 1, v: 1, a: 1 })}
        valueText={`${Math.round(hsv.h)} degrees`}
        onChange={(h, final) => emit({ ...hsv, h }, final)}
      />
      <Track
        label={`${name} opacity`}
        value={Math.round(hsv.a * 100)}
        max={100}
        background={`linear-gradient(90deg, transparent, ${opaque}), ${CHECKER}`}
        thumb={hex}
        valueText={`${Math.round(hsv.a * 100)}%`}
        onChange={(a, final) => emit({ ...hsv, a: a / 100 }, final)}
      />
      <div className="flex items-center gap-2">
        <input
          aria-label={`${name} hex code`}
          spellCheck={false}
          value={hexDraft ?? hex}
          onFocus={(e) => {
            setHexDraft(hex);
            requestAnimationFrame(() => e.target.select());
          }}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={() => {
            const c = hexDraft && parseHex(hexDraft) ? `#${hexDraft.trim().replace(/^#/, "").toUpperCase()}` : null;
            if (c && c !== hex) pick(c.length === 9 && c.endsWith("FF") ? c.slice(0, 7) : c);
            setHexDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="h-8 min-w-0 flex-1 rounded-lg bg-field px-2.5 text-[13px] font-medium uppercase tabular-nums outline-none focus:outline-2 focus:outline-offset-1 focus:outline-text"
        />
        {eyeDropper() && (
          <button
            type="button"
            aria-label="Pick a colour from the screen"
            title="Pick a colour from the screen"
            onClick={async () => {
              const Picker = eyeDropper();
              if (!Picker) return;
              try {
                pick((await new Picker().open()).sRGBHex.toUpperCase());
              } catch {
                // Cancelled with Escape.
              }
            }}
            className="grid size-8 flex-none place-items-center rounded-lg bg-field text-muted transition hover:text-text active:scale-[.94]"
          >
            <Pipette aria-hidden className="size-4" />
          </button>
        )}
      </div>
      {docColors.length > 0 && <SwatchRow title="In this design" colors={docColors.slice(0, 12)} current={hex} onPick={pick} />}
      <SwatchRow title="Swatches" colors={SWATCHES} current={hex} onPick={pick} />
    </div>
  );
}

/** Saturation left to right, brightness bottom to top, for the current hue. */
function Area({ hsv, onChange, name }: { hsv: Hsv; onChange: (next: Hsv, final: boolean) => void; name: string }) {
  const box = useRef<HTMLDivElement>(null);
  const at = (e: ReactPointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { ...hsv, s: clamp01((e.clientX - r.left) / r.width), v: clamp01(1 - (e.clientY - r.top) / r.height) };
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const d = move[e.key];
    if (!d) return;
    e.preventDefault();
    onChange({ ...hsv, s: clamp01(hsv.s + d[0]), v: clamp01(hsv.v + d[1]) }, true);
  };
  return (
    <div
      ref={box}
      role="slider"
      tabIndex={0}
      aria-label={`${name} saturation and brightness`}
      aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onChange(at(e), false);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onChange(at(e), false);
      }}
      onPointerUp={(e) => onChange(at(e), true)}
      className="relative h-[150px] cursor-crosshair touch-none rounded-[10px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
      style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)` }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.3),0_1px_3px_rgba(0,0,0,.35)]"
        style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex({ ...hsv, a: 1 }) }}
      />
    </div>
  );
}

/** A horizontal slider with a painted track; previews while moving, final on release. */
function Track({
  label,
  value,
  max,
  background,
  thumb,
  valueText,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  background: string;
  thumb: string;
  valueText: string;
  onChange: (value: number, final: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  // React's onChange is the native `input` event; the native `change` fires once, on release.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const done = () => latest.current(Number(el.value), true);
    el.addEventListener("change", done);
    return () => el.removeEventListener("change", done);
  }, []);

  return (
    <div className="relative h-3.5 rounded-full" style={{ background }}>
      <input
        ref={input}
        type="range"
        aria-label={label}
        aria-valuetext={valueText}
        min={0}
        max={max}
        step={1}
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value), false)}
        className="peer absolute inset-0 size-full cursor-pointer opacity-0"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.3),0_1px_3px_rgba(0,0,0,.35)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-text"
        style={{ left: `${(value / max) * 100}%`, background: thumb }}
      />
    </div>
  );
}

function SwatchRow({ title, colors, current, onPick }: { title: string; colors: string[]; current: string; onPick: (hex: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-muted">{title}</span>
      <div className="grid grid-cols-[repeat(8,1fr)] gap-1.5">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            title={c}
            aria-pressed={c === current}
            onClick={() => onPick(c)}
            className={cn(
              "aspect-square rounded-md shadow-[inset_0_0_0_.5px_var(--line)] transition hover:scale-110 active:scale-95",
              c === current && "outline-2 outline-offset-1 outline-text",
            )}
            style={{ background: c.length === 9 ? `linear-gradient(${c}, ${c}), ${CHECKER}` : c }}
          />
        ))}
      </div>
    </div>
  );
}
