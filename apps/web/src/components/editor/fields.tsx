"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const FIELD = "flex h-8 min-w-0 items-center gap-2 rounded-lg bg-field px-2.5 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-text";

const round = (n: number, digits: number) => Number(n.toFixed(digits));

/**
 * A compact numeric input: type a value, then Enter or Tab away to apply it (one undo step); Escape
 * reverts. Arrow keys step by `step` (×10 with Shift) and apply straight away.
 */
export function NumberField({
  label,
  name,
  value,
  onCommit,
  min = -Infinity,
  max = Infinity,
  step = 1,
  digits = 0,
  suffix,
  disabled,
}: {
  /** Short visible label ("X", "W", "↻"). */
  label: ReactNode;
  /** Accessible name ("X position"). */
  name: string;
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const skip = useRef(false);
  const shown = draft ?? String(round(value, digits));

  const apply = (n: number) => {
    const next = round(Math.min(max, Math.max(min, n)), digits);
    if (next !== round(value, digits)) onCommit(next);
  };
  const commit = () => {
    if (draft !== null && !skip.current) {
      const n = Number(draft.replace(",", "."));
      if (Number.isFinite(n) && draft.trim() !== "") apply(n);
    }
    skip.current = false;
    setDraft(null);
  };

  return (
    <label className={cn(FIELD, disabled && "opacity-45")}>
      <span aria-hidden className="w-3.5 flex-none text-center text-[12px] text-muted">
        {label}
      </span>
      <input
        aria-label={name}
        inputMode="decimal"
        disabled={disabled}
        value={shown}
        onFocus={(e) => {
          setDraft(String(round(value, digits)));
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            skip.current = true;
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const base = Number(draft ?? value);
            const n = (Number.isFinite(base) ? base : value) + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const next = round(Math.min(max, Math.max(min, n)), digits);
            setDraft(String(next));
            apply(next);
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-[13px] font-medium tabular-nums outline-none disabled:cursor-not-allowed"
      />
      {suffix && (
        <span aria-hidden className="flex-none text-[12px] text-muted">
          {suffix}
        </span>
      )}
    </label>
  );
}

const HEX = /^#?([0-9a-f]{6})$/i;

/**
 * A colour swatch (the system picker) plus its hex code. Dragging in the picker previews live and
 * applies once when the picker closes (`final`), so it's one undo step. Alpha in #RRGGBBAA is kept.
 */
export function ColorField({
  name,
  value,
  onChange,
  disabled,
  display,
}: {
  name: string;
  value: string;
  onChange: (color: string, final: boolean) => void;
  disabled?: boolean;
  /** Text shown instead of the hex code (e.g. "Gradient"). */
  display?: string;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const alpha = value.length === 9 ? value.slice(7) : "";
  const rgb = value.slice(0, 7).toUpperCase();
  const latest = useRef(onChange);
  latest.current = onChange;

  // React's onChange is the native `input` event; the native `change` fires once, when the picker closes.
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const done = () => latest.current(`${el.value.toUpperCase()}${alpha}`, true);
    el.addEventListener("change", done);
    return () => el.removeEventListener("change", done);
  }, [alpha]);

  const commitHex = () => {
    const m = draft && HEX.exec(draft.trim());
    if (m && `#${m[1]!.toUpperCase()}` !== rgb) onChange(`#${m[1]!.toUpperCase()}${alpha}`, true);
    setDraft(null);
  };

  return (
    <div className={cn(FIELD, "pl-1.5", disabled && "opacity-45")}>
      <span className="relative size-5 flex-none overflow-hidden rounded-[5px] shadow-[inset_0_0_0_.5px_var(--line)]" style={{ background: value.slice(0, 7) }}>
        <input
          ref={picker}
          type="color"
          aria-label={`${name} colour`}
          disabled={disabled}
          value={rgb.toLowerCase()}
          onChange={(e) => onChange(`${e.target.value.toUpperCase()}${alpha}`, false)}
          className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
      </span>
      <input
        aria-label={`${name} hex code`}
        disabled={disabled}
        spellCheck={false}
        value={draft ?? display ?? rgb}
        onFocus={(e) => {
          setDraft(rgb);
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitHex}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(null);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-[13px] font-medium uppercase tabular-nums outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}

export function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  name: string;
  value: T;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={name} className={cn("flex rounded-[10px] bg-field p-[3px]", disabled && "opacity-45")}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.icon ? o.label : undefined}
          title={o.icon ? o.label : undefined}
          disabled={disabled}
          onClick={() => value !== o.value && onChange(o.value)}
          className={cn(
            "flex h-[26px] flex-1 items-center justify-center rounded-[7px] px-2 text-[12px] whitespace-nowrap text-muted hover:text-text disabled:cursor-not-allowed [&_svg]:size-4",
            value === o.value && "bg-(--seg) font-medium text-text shadow-(--segsh)",
          )}
        >
          {o.icon ?? o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative h-[22px] w-[38px] flex-none rounded-full bg-field shadow-[inset_0_0_0_.5px_var(--line)] transition-colors disabled:opacity-45", checked && "bg-text")}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-[2px] left-[2px] size-[18px] rounded-full bg-bg shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-transform motion-reduce:transition-none",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}

export function SelectField({
  name,
  value,
  onChange,
  children,
  disabled,
  style,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const id = useId();
  return (
    <div className={cn(FIELD, "relative p-0", disabled && "opacity-45")}>
      <label htmlFor={id} className="sr-only">
        {name}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={style}
        className="h-full min-w-0 flex-1 cursor-pointer appearance-none bg-transparent pr-7 pl-2.5 text-[13px] font-medium outline-none disabled:cursor-not-allowed"
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2 size-3.5 text-muted" />
    </div>
  );
}

/**
 * A labelled range slider. Dragging previews live (`final` false) and the release applies once, so a
 * drag is one undo step; arrow keys apply each step.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number, final: boolean) => void;
  disabled?: boolean;
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
    <label className={cn("flex flex-col gap-1", disabled && "opacity-45")}>
      <span className="flex items-center justify-between text-[12px]">
        <span className="text-muted">{label}</span>
        <span className="font-medium tabular-nums">{Math.round(value * 100)}</span>
      </span>
      <input
        ref={input}
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value), false)}
        className="h-4 w-full cursor-pointer accent-(--text) disabled:cursor-not-allowed"
      />
    </label>
  );
}

/** A labelled row: muted label on the left, control on the right. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      {children}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t-[.5px] border-line pt-3.5 first:border-t-0 first:pt-0">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}
