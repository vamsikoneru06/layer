"use client";

import { createEditor, type Editor, type EditorState } from "@vash/engine";
import { parseDoc, type Doc } from "@vash/schema";
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
import { createImageLoader } from "@/lib/images";
import { cn } from "@/lib/utils";
import { ExportPopover } from "./export-popover";
import { Segmented } from "./fields";
import { InsertRail } from "./insert-rail";
import { usePhotoDrop } from "./use-photo-drop";
import { LayersPanel } from "./layers-panel";
import { PropertiesPanel } from "./properties-panel";
import { TextEditor } from "./text-editor";
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
  retrying: { icon: <CloudAlert aria-hidden />, label: "Couldn’t save, retrying" },
  "signed-out": { icon: <CloudAlert aria-hidden />, label: "Signed out, changes not saved" },
  error: { icon: <CloudAlert aria-hidden />, label: "Couldn’t save" },
  conflict: { icon: <CloudAlert aria-hidden />, label: "Changed elsewhere" },
};

const LINK = "font-medium text-text underline-offset-4 hover:underline";

function SaveIndicator({ status, onRetry, onResolve }: { status: SaveStatus; onRetry: () => void; onResolve: () => void }) {
  const s = STATUS[status];
  const alarming = status === "error" || status === "conflict" || status === "signed-out";
  return (
    <span role="status" className={cn("flex items-center gap-1.5 text-[13px] text-muted [&_svg]:size-4", alarming && "text-danger")}>
      {s.icon}
      {s.label}
      {status === "signed-out" && (
        // A new tab, so this editor and its unsaved changes stay open; saving resumes on return.
        <a href="/signin" target="_blank" rel="noopener" className={LINK}>
          Sign in
        </a>
      )}
      {(status === "error" || status === "signed-out" || status === "retrying") && (
        <button type="button" onClick={onRetry} className={LINK}>
          Retry
        </button>
      )}
      {status === "conflict" && (
        <button type="button" onClick={onResolve} className={LINK}>
          Resolve
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
  const [panel, setPanel] = useState<"properties" | "layers">("properties");
  const [conflictOpen, setConflictOpen] = useState(true);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const state = useEditorState(editor);

  useEffect(() => {
    // Photos load in the background; the canvas redraws as each arrives.
    let e: Editor | null = null;
    const images = createImageLoader(() => e?.invalidate());
    e = createEditor({ container: container.current!, scene: scene.current!, overlay: overlay.current!, doc: design.doc, image: images.image, imagesReady: images.ready });
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
    // Back from signing in (or from another tab): try the pending save again.
    const resume = () => {
      if (document.visibilityState === "visible" && s.dirty) void s.flush();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("visibilitychange", resume);
      off();
      // Leaving within the app: send whatever is pending, then stop.
      void s.flush().finally(() => s.dispose());
      e.destroy();
    };
  }, [design]);

  const photoDrop = usePhotoDrop(editor);

  // Refusals ("Layout locked by template…") show briefly, then clear.
  const notice = state?.notice ?? null;
  useEffect(() => {
    if (!notice || !editor) return;
    const t = setTimeout(() => editor.core.setChrome({ notice: null }), 3500);
    return () => clearTimeout(t);
  }, [notice, editor]);

  // A new conflict always shows the dialog again.
  useEffect(() => {
    if (status !== "conflict") return;
    setConflictOpen(true);
    setConflictError(null);
  }, [status]);

  /** Runs a conflict action, keeping the dialog open with the reason if it fails. */
  async function resolving(action: () => Promise<void>) {
    setConflictBusy(true);
    setConflictError(null);
    try {
      await action();
    } catch (err) {
      setConflictError(err instanceof Error ? err.message : "That didn’t work. Try again.");
    } finally {
      setConflictBusy(false);
    }
  }

  const reloadTheirs = () =>
    resolving(async () => {
      if (!editor || !saver.current) return;
      const fresh = await getDesign(design.id);
      // The same validation as on first open; never hand the engine a malformed document.
      const parsed = parseDoc(fresh.doc, { kind: "design" });
      if (!parsed.ok) throw new Error("The newer version couldn’t be opened. Keep yours as a copy instead.");
      editor.core.endTextEdit(false);
      editor.core.history.reset(parsed.doc);
      saver.current.reset(fresh.version);
    });

  const keepMineAsCopy = () =>
    resolving(async () => {
      if (!editor) return;
      const doc = editor.getState().doc;
      const { id } = await saveDesignAsCopy(doc, `Copy of ${doc.meta.title}`.slice(0, 120));
      saver.current?.reset(saver.current.version);
      router.push(`/edit/${id}`);
    });

  const zoom = state?.viewport.zoom ?? 1;
  const artboard = state?.doc.artboard ?? design.doc.artboard;

  return (
    <main className="flex h-svh flex-col overflow-hidden bg-bg text-text">
      <header className="flex h-14 flex-none items-center gap-3 border-b-[.5px] border-line px-3">
        <Link href="/designs" aria-label="Back to your designs" className="flex-none rounded-md transition-opacity hover:opacity-75">
          <Image src="/vash-logo.png" alt="" width={28} height={28} className="size-7 rounded-md" priority />
        </Link>
        <h1 className="max-w-[320px] truncate text-sm font-semibold">{state?.doc.meta.title ?? design.title}</h1>
        <SaveIndicator status={status} onRetry={() => void saver.current?.flush()} onResolve={() => setConflictOpen(true)} />
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
        <ExportPopover editor={editor} doc={state?.doc ?? design.doc} />
      </header>

      <div className="flex min-h-0 flex-1">
        <InsertRail editor={editor} />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div ref={container} {...photoDrop} className="relative min-h-0 flex-1 overflow-hidden bg-bg2">
            <canvas ref={scene} className="absolute inset-0" aria-hidden />
            <canvas ref={overlay} className="absolute inset-0 touch-none" aria-label="Design canvas. Use the Layers panel to select layers with the keyboard." />
            {state && editor && <TextEditor editor={editor} state={state} />}
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
        <aside className="flex w-[288px] flex-none flex-col border-l-[.5px] border-line text-[13px]" aria-label="Design panel">
          <div className="px-4 pt-3.5 pb-3">
            <Segmented
              name="Panel"
              value={panel}
              options={[
                { value: "properties", label: "Properties" },
                { value: "layers", label: "Layers" },
              ]}
              onChange={setPanel}
            />
          </div>
          {state && editor && panel === "properties" && (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <PropertiesPanel state={state} core={editor.core} />
            </div>
          )}
          {state && editor && panel === "layers" && <LayersPanel state={state} core={editor.core} />}
        </aside>
      </div>

      <Dialog open={status === "conflict" && conflictOpen} onClose={() => setConflictOpen(false)} title="This design changed in another tab">
        <p className="text-sm text-muted">
          Someone (maybe you, in another tab) saved a newer version. Choose which one to keep. Until you do, your changes here aren&apos;t saved.
        </p>
        {conflictError && (
          <p role="alert" className="text-sm text-danger">
            {conflictError}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setConflictOpen(false)} disabled={conflictBusy}>
            Decide later
          </Button>
          <Button variant="secondary" onClick={() => void keepMineAsCopy()} disabled={conflictBusy}>
            Keep mine as a copy
          </Button>
          <Button onClick={() => void reloadTheirs()} loading={conflictBusy}>
            Reload their version
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
