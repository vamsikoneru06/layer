"use client";

import type { Editor } from "@vash/engine";
import type { Doc } from "@vash/schema";
import { Redo2, Undo2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { SaveStatus } from "@/lib/autosave";
import type { Action, ActionId } from "./editor-actions";
import { ExportPopover } from "./export-popover";
import { IconButton } from "./icon-button";
import { MenuBar } from "./menu-bar";
import { SaveIndicator } from "./save-indicator";
import { TitleField } from "./title-field";

export function EditorHeader({
  editor,
  doc,
  canUndo,
  canRedo,
  status,
  onRetry,
  onResolve,
  exportOpen,
  onExportOpenChange,
  renaming,
  onRenamingChange,
  actions,
  mac,
}: {
  editor: Editor | null;
  doc: Doc;
  canUndo: boolean;
  canRedo: boolean;
  status: SaveStatus;
  onRetry: () => void;
  onResolve: () => void;
  exportOpen: boolean;
  onExportOpenChange: (open: boolean) => void;
  renaming: boolean;
  onRenamingChange: (renaming: boolean) => void;
  actions: Record<ActionId, Action> | null;
  mac: boolean;
}) {
  return (
    <header className="flex h-14 flex-none items-center gap-3 px-3">
      <Link href="/designs" aria-label="Back to your designs" className="flex-none rounded-md transition-opacity hover:opacity-75">
        <Image src="/vash-logo.png" alt="" width={28} height={28} className="size-7 rounded-md" priority />
      </Link>
      {actions && <MenuBar actions={actions} mac={mac} />}
      <TitleField title={doc.meta.title} editing={renaming} onEditingChange={onRenamingChange} onCommit={(title) => editor?.core.dispatch({ type: "meta", patch: { title } })} />
      <SaveIndicator status={status} onRetry={onRetry} onResolve={onResolve} />
      <div className="flex-1" />
      <IconButton label="Undo (Ctrl+Z)" onClick={() => editor?.core.undo()} disabled={!canUndo}>
        <Undo2 aria-hidden />
      </IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" onClick={() => editor?.core.redo()} disabled={!canRedo}>
        <Redo2 aria-hidden />
      </IconButton>
      <ExportPopover editor={editor} doc={doc} open={exportOpen} onOpenChange={onExportOpenChange} />
    </header>
  );
}
