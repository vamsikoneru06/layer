"use client";

import { createEditor, type Editor, type EditorState } from "@vash/engine";
import type { Doc } from "@vash/schema";
import { ChevronDown, CloudAlert, CloudCheck, CloudOff, CloudUpload, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Menu } from "@/components/ui/menu";
import { getDesign, saveDesign, saveDesignAsCopy, type Design } from "@/lib/api";
import { createAutosaver, type Autosaver, type SaveStatus } from "@/lib/autosave";
import { cn } from "@/lib/utils";
import { LayersPanel } from "./layers-panel";
// Self-hosted allowlisted fonts, loaded only on the editor route.
import "./fonts.css";

const NO_EDITOR = { subscribe: () => () => {}, get: () => null };

function useEditorState(editor: Editor | null): EditorState | null {
  return useSyncExternalStore(editor ? editor.subscribe : NO_EDITOR.subscribe, editor ? editor.getState : NO_EDITOR.get, NO_EDITOR.get);
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-8 items-center justify-center rounded-lg text-text hover:bg-field disabled:opacity-35 disabled:hover:bg-transparent [&_svg]:size-[18px]"
    >
      {children}
    </button>
  );
}

const STATUS: Record<SaveStatus, { icon: ReactNode; label: string }> = {
  saved: { icon: <CloudCheck aria-hidden />, label: "Saved" },
  unsaved: { icon: <CloudUpload aria-hidden />, label: "Unsaved changes" },
  saving: { icon: <CloudUpload aria-hidden />, label: "Saving…" },
  offline: { icon: <CloudOff aria-hidden />, label: "Offline, retrying" },
  error: { icon: <CloudAlert aria-hidden />, label: "Couldn’t save" },
  conflict: { icon: <CloudAlert aria-hidden />, label: "Changed elsewhere" },
};

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  const s = STATUS[status];
  return (
    <span role="status" className={cn("flex items-center gap-1.5 text-[13px] text-muted [&_svg]:size-4", (status === "error" || status === "conflict") && "text-danger")}>
      {s.icon}
      {s.label}
      {status === "error" && (
        <button type="button" onClick={onRetry} className="font-medium text-text underline-offset-4 hover:underline">
          Retry
        </button>
      )}
    </span>
  );
}

export function Workspace({ design }: { design: Design }) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const saver = useRef<Autosaver<Doc> | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const state = useEditorState(editor);

  useEffect(() => {
    const e = createEditor({ container: container.current!, scene: scene.current!, overlay: overlay.current!, doc: design.doc });
    setEditor(e);
    const s = createAutosaver<Doc>({ version: design.version, delayMs: 1500, retryMs: 5000, save: (doc, v) => saveDesign(design.id, doc, v), onStatus: setStatus });
    saver.current = s;
    let last = e.getState().doc;
    const off = e.subscribe(() => {
      const doc = e.getState().doc;
      if (doc !== last) {
        last = doc;
        s.change(doc);
      }
    });
    const warn = (ev: BeforeUnloadEvent) => {
      if (s.dirty) ev.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      off();
      // Leaving within the app: send whatever is pending, then stop.
      void s.flush().finally(() => s.dispose());
      e.destroy();
    };
  }, [design]);

  // Refusals ("Layout locked by template…") show briefly, then clear.
  const notice = state?.notice ?? null;
  useEffect(() => {
    if (!notice || !editor) return;
    const t = setTimeout(() => editor.core.setChrome({ notice: null }), 3500);
    return () => clearTimeout(t);
  }, [notice, editor]);

  async function reloadTheirs() {
    if (!editor || !saver.current) return;
    const fresh = await getDesign(design.id);
    editor.core.history.reset(fresh.doc);
    saver.current.reset(fresh.version);
  }

  async function keepMineAsCopy() {
    if (!editor) return;
    const doc = editor.getState().doc;
    const { id } = await saveDesignAsCopy(doc, `Copy of ${doc.meta.title}`.slice(0, 120));
    saver.current?.reset(saver.current.version);
    router.push(`/edit/${id}`);
  }

  const zoom = state?.viewport.zoom ?? 1;
  const artboard = state?.doc.artboard ?? design.doc.artboard;

  return (
    <main className="flex h-svh flex-col overflow-hidden bg-bg text-text">
      <header className="flex h-14 flex-none items-center gap-3 border-b-[.5px] border-line px-3">
        <Link href="/designs" aria-label="Back to your designs" className="flex-none rounded-md">
          <Image src="/vash-logo.png" alt="" width={28} height={28} className="size-7 rounded-md" priority />
        </Link>
        <h1 className="max-w-[320px] truncate text-sm font-semibold">{state?.doc.meta.title ?? design.title}</h1>
        <SaveIndicator status={status} onRetry={() => void saver.current?.flush()} />
        <div className="flex-1" />
        <IconButton label="Undo (Ctrl+Z)" onClick={() => editor?.core.undo()} disabled={!state?.canUndo}>
          <Undo2 aria-hidden />
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" onClick={() => editor?.core.redo()} disabled={!state?.canRedo}>
          <Redo2 aria-hidden />
        </IconButton>
        <Menu
          items={[
            { label: "Fit to screen", onSelect: () => editor?.fit() },
            "separator",
            ...[0.5, 1, 2].map((z) => ({ label: `${z * 100}%`, onSelect: () => editor?.zoomTo(z) })),
          ]}
          trigger={(props) => (
            <button type="button" {...props} aria-label="Zoom" className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium tabular-nums hover:bg-field">
              {Math.round(zoom * 100)}%
              <ChevronDown aria-hidden className="size-3.5 text-muted" />
            </button>
          )}
        />
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div ref={container} className="relative min-h-0 flex-1 overflow-hidden bg-bg2">
            <canvas ref={scene} className="absolute inset-0" aria-hidden />
            <canvas ref={overlay} className="absolute inset-0 touch-none" aria-label="Design canvas. Use the Layers panel to select layers with the keyboard." />
            {notice && (
              <div role="status" className="glass-primary pointer-events-none absolute top-4 left-1/2 max-w-[80%] -translate-x-1/2 rounded-xl px-4 py-2 text-[13px] text-white">
                {notice}
              </div>
            )}
          </div>
          <footer className="flex h-10 flex-none items-center gap-1 border-t-[.5px] border-line px-3 text-[13px] text-muted">
            <IconButton label="Zoom out" onClick={() => editor?.zoomTo(zoom / 1.25)}>
              <ZoomOut aria-hidden />
            </IconButton>
            <IconButton label="Zoom in" onClick={() => editor?.zoomTo(zoom * 1.25)}>
              <ZoomIn aria-hidden />
            </IconButton>
            <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => editor?.fit()} className="h-7 rounded-md px-2 font-medium text-text hover:bg-field">
              Fit
            </button>
            <div className="flex-1" />
            <span className="tabular-nums">
              {artboard.width} × {artboard.height}
            </span>
          </footer>
        </div>
        <aside className="flex w-[300px] flex-none flex-col border-l-[.5px] border-line" aria-label="Layers">
          <h2 className="px-4 pt-4 pb-2 text-[13px] font-semibold">Layers</h2>
          {state && editor && <LayersPanel state={state} core={editor.core} />}
        </aside>
      </div>

      <Dialog open={status === "conflict"} onClose={() => {}} title="This design changed in another tab">
        <p className="text-sm text-muted">Someone (maybe you, in another tab) saved a newer version. Choose which one to keep.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => void keepMineAsCopy()}>
            Keep mine as a copy
          </Button>
          <Button onClick={() => void reloadTheirs()}>Reload their version</Button>
        </div>
      </Dialog>
    </main>
  );
}
