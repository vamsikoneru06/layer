"use client";

import type { Editor, EditorState } from "@vash/engine";
import { LIMITS } from "@vash/schema";
import { useEffect, useRef } from "react";

/**
 * The text box shown over a text layer while it's being typed into. The canvas skips that layer, so
 * this draws the text itself with the layer's font, size (after shrink-to-fit), colour and alignment,
 * transformed exactly like the layer. Escape cancels; Ctrl/⌘+Enter or clicking away keeps the text.
 */
export function TextEditor({ editor, state }: { editor: Editor; state: EditorState }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const editing = state.editing;

  useEffect(() => {
    if (!editing) return;
    ref.current?.focus();
    ref.current?.select();
  }, [editing]);

  const box = editing ? editor.textEditBox() : null;
  if (!box) return null;
  const { node } = box;

  return (
    <textarea
      ref={ref}
      aria-label={`Edit text: ${node.name}`}
      value={node.content}
      maxLength={node.maxChars ?? LIMITS.textChars}
      spellCheck
      autoComplete="off"
      onChange={(e) => editor.core.editText(e.target.value)}
      onBlur={() => editor.core.endTextEdit(true)}
      onKeyDown={(e) => {
        // While an input method (Telugu, Devanagari, CJK...) is composing, Escape and Enter belong to it.
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Escape") {
          e.preventDefault();
          editor.core.endTextEdit(false);
        } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          editor.core.endTextEdit(true);
        }
      }}
      className="absolute top-0 left-0 m-0 resize-none overflow-hidden border-0 bg-transparent p-0 whitespace-pre-wrap outline-none [overflow-wrap:anywhere]"
      style={{
        width: box.width,
        height: box.height,
        paddingTop: box.paddingTop,
        transform: `matrix(${box.matrix.join(",")})`,
        transformOrigin: "0 0",
        fontFamily: `"${node.font.family}", system-ui, sans-serif`,
        fontWeight: node.font.weight,
        fontStyle: node.font.style,
        fontSize: box.fontSize,
        lineHeight: `${box.lineHeight}px`,
        letterSpacing: node.letterSpacing,
        textAlign: node.align,
        textAlignLast: node.align === "justify" ? "left" : undefined,
        color: node.color,
        caretColor: node.color,
        opacity: node.opacity,
      }}
    />
  );
}
