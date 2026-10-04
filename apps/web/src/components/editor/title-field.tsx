"use client";

import { LIMITS } from "@vash/schema";
import { useEffect, useRef, useState } from "react";
import { normalizeTitle } from "@/lib/title";
import { cn } from "@/lib/utils";

/** The design's name in the header. Click to rename; Enter or clicking away keeps it, Escape cancels. */
export function TitleField({ title, editing, onEditingChange, onCommit }: { title: string; editing: boolean; onEditingChange: (editing: boolean) => void; onCommit: (title: string) => void }) {
  if (!editing) {
    return (
      <h1 className="min-w-0">
        <button type="button" onClick={() => onEditingChange(true)} title="Rename" className="max-w-[240px] truncate rounded-lg px-2 py-1 text-sm font-semibold hover:bg-field">
          {title}
        </button>
      </h1>
    );
  }
  return <TitleInput title={title} onEditingChange={onEditingChange} onCommit={onCommit} />;
}

/** Mounted fresh each time renaming starts, so it always begins from the current name with all of it selected. */
function TitleInput({ title, onEditingChange, onCommit }: { title: string; onEditingChange: (editing: boolean) => void; onCommit: (title: string) => void }) {
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const finish = (keepOpenOnError: boolean) => {
    const result = normalizeTitle(draft);
    if (!result.ok) {
      if (keepOpenOnError) {
        setError(result.reason);
        return;
      }
      onEditingChange(false);
      return;
    }
    if (result.title !== title) onCommit(result.title);
    onEditingChange(false);
  };

  return (
    <div className="relative min-w-0">
      <input
        ref={input}
        value={draft}
        maxLength={LIMITS.titleChars}
        aria-label="Design name"
        aria-invalid={error !== null}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={() => finish(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") {
            e.stopPropagation();
            onEditingChange(false);
          }
        }}
        className={cn("h-8 w-[240px] rounded-lg bg-field px-2 text-sm font-semibold outline-none focus-visible:shadow-[0_0_0_2px_var(--text)]", error && "shadow-[0_0_0_2px_var(--danger)]")}
      />
      {error && (
        <p role="alert" className="absolute top-full left-2 mt-1 text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
