"use client";

import { copySelection, cutSelection, pasteText, type Editor } from "@vash/engine";
import { useCallback, useEffect, useRef } from "react";

/** Keys and clipboard events inside a field or a dialog belong to it, not to the canvas. */
const inField = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.closest("dialog") !== null);

/** Highlighted page text (a panel label, say) keeps the browser's own copy and cut. */
const hasPageSelection = () => {
  const s = window.getSelection();
  return s !== null && !s.isCollapsed && s.toString().trim() !== "";
};

/**
 * Copy, cut and paste for the canvas. The keyboard and the browser's own menu go through the clipboard
 * events; the Edit and right-click menus call the returned functions, which use the async clipboard API.
 * If that is blocked, this tab's last copy is used instead.
 */
export function useClipboard(editor: Editor | null) {
  const memory = useRef<string | null>(null);

  const write = useCallback(async (text: string) => {
    memory.current = text;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Blocked: the in-memory copy still serves pastes in this tab.
    }
  }, []);

  const copy = useCallback(async () => {
    const text = editor && copySelection(editor.core);
    if (text) await write(text);
  }, [editor, write]);

  const cut = useCallback(async () => {
    const text = editor && cutSelection(editor.core);
    if (text) await write(text);
  }, [editor, write]);

  const paste = useCallback(async () => {
    if (!editor) return;
    let text = memory.current ?? "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Blocked or denied: paste this tab's last copy.
    }
    pasteText(editor.core, text);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const onCopy = (e: ClipboardEvent) => {
      if (inField(e.target) || hasPageSelection()) return;
      const text = copySelection(editor.core);
      if (!text) return;
      e.clipboardData?.setData("text/plain", text);
      memory.current = text;
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      if (inField(e.target) || hasPageSelection()) return;
      const text = cutSelection(editor.core);
      if (!text) return;
      e.clipboardData?.setData("text/plain", text);
      memory.current = text;
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (inField(e.target)) return;
      e.preventDefault();
      pasteText(editor.core, e.clipboardData?.getData("text/plain") ?? "");
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, [editor]);

  return { copy, cut, paste };
}
