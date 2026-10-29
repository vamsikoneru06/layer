"use client";

import { LIMITS, type Node } from "@vash/schema";
import { useId, useRef, useState } from "react";
import { cleanAlt } from "@/lib/alt-text";
import { cn } from "@/lib/utils";
import { Section } from "./fields";

const INPUT = "h-8 min-w-0 rounded-lg bg-field px-2.5 text-[13px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text disabled:cursor-not-allowed";

/**
 * Alt text for a layer, read out by screen readers. Saved on blur or Enter; Escape puts back the saved
 * text. Text layers have none, since their words already are the description.
 */
export function AltTextSection({ node, disabled, update }: { node: Node; disabled: boolean; update: (patch: Record<string, unknown>, final?: boolean) => void }) {
  const saved = node.alt ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const skip = useRef(false);
  const inputId = useId();
  const helpId = useId();

  const commit = () => {
    if (draft !== null && !skip.current) {
      const next = cleanAlt(draft);
      if (next !== saved) update({ alt: next || undefined });
    }
    skip.current = false;
    setDraft(null);
  };

  return (
    <Section title="Accessibility">
      <div className={cn("flex flex-col gap-1.5", disabled && "opacity-45")}>
        <label htmlFor={inputId} className="text-[13px] text-muted">
          Alt text
        </label>
        <input
          id={inputId}
          type="text"
          aria-describedby={helpId}
          maxLength={LIMITS.altChars}
          disabled={disabled}
          value={draft ?? saved}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
              skip.current = true;
              e.currentTarget.blur();
            }
          }}
          className={INPUT}
        />
        <p id={helpId} className="text-[12px] text-muted">
          Describes this layer for people using screen readers.
        </p>
      </div>
    </Section>
  );
}
