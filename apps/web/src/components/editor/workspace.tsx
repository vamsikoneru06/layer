"use client";

import { createEditor, type Editor, type EditorState } from "@vash/engine";
import { parseDoc, type Doc } from "@vash/schema";
import { ZoomIn, ZoomOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { duplicateDesign, getDesign, saveDesign, saveDesignAsCopy, type Design } from "@/lib/api";
import { createAutosaver, type Autosaver, type SaveStatus } from "@/lib/autosave";
import { createImageLoader } from "@/lib/images";
import { DesignInfoDialog } from "./design-info-dialog";
import { buildActions, type ActionHost } from "./editor-actions";
import { EditorHeader } from "./editor-header";
import { Segmented } from "./fields";
import { IconButton } from "./icon-button";
import { InsertRail } from "./insert-rail";
import { LayersPanel } from "./layers-panel";
import { MoveDialog } from "./move-dialog";
import { PropertiesPanel } from "./properties-panel";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { TextEditor } from "./text-editor";
import { useClipboard } from "./use-clipboard";
import { useFullscreen } from "./use-fullscreen";
// Self-hosted allowlisted fonts, loaded only on the editor route.
import "./fonts.css";

const NO_EDITOR = { subscribe: () => () => {}, get: () => null };

function useEditorState(editor: Editor | null): EditorState | null {
  return useSyncExternalStore(editor ? editor.subscribe : NO_EDITOR.subscribe, editor ? editor.getState : NO_EDITOR.get, NO_EDITOR.get);
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
  const [exportOpen, setExportOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const state = useEditorState(editor);
  const toast = useToast();
  const clipboard = useClipboard(editor);
  const root = useRef<HTMLElement>(null);
  const fullscreen = useFullscreen(root);
  const [infoOpen, setInfoOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [savedAt, setSavedAt] = useState(design.updatedAt);
  const [folderId, setFolderId] = useState(design.folderId);
  const mac = useMemo(() => typeof navigator !== "undefined" && navigator.platform.startsWith("Mac"), []);

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

  // Refusals ("Layout locked by the template.") and other engine messages show as a toast, then clear.
  const notice = state?.notice ?? null;
  useEffect(() => {
    if (!notice || !editor) return;
    toast({ message: notice, duration: 3500 });
    editor.core.setChrome({ notice: null });
  }, [notice, editor, toast]);

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

  // When a save finishes, "Last saved" in Design info moves on.
  const wasSaved = useRef(true);
  useEffect(() => {
    if (status === "saved" && !wasSaved.current) setSavedAt(new Date().toISOString());
    wasSaved.current = status === "saved";
  }, [status]);

  /** Saves now. `flush` never throws; a leftover `dirty` means the save did not go through. */
  async function saveNow() {
    const s = saver.current;
    if (!s) return;
    await s.flush();
    toast({ message: s.dirty ? "Not saved yet. The status at the top shows why." : "All changes saved.", duration: 3000 });
  }

  async function makeCopy() {
    const s = saver.current;
    try {
      if (s?.dirty) await s.flush();
      if (s?.dirty) {
        toast({ message: "Your latest changes are still saving. Try again in a moment." });
        return;
      }
      const copy = await duplicateDesign(design.id);
      router.push(`/edit/${copy.id}`);
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn’t make a copy. Try again." });
    }
  }

  // Ctrl+S saves and keeps the browser's Save dialog away.
  const save = useRef(saveNow);
  save.current = saveNow;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((mac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mac]);

  // Escape brings hidden panels back.
  useEffect(() => {
    if (!panelsHidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelsHidden(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelsHidden]);

  // The canvas area changes size when panels hide or fullscreen starts: fit once the layout has settled.
  useEffect(() => {
    if (!editor) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => editor.fit()));
    return () => cancelAnimationFrame(frame);
  }, [editor, panelsHidden, fullscreen.active]);

  const host: ActionHost = {
    panelsHidden,
    canFullscreen: fullscreen.supported,
    copy: () => void clipboard.copy(),
    cut: () => void clipboard.cut(),
    paste: () => void clipboard.paste(),
    newDesign: () => router.push("/home#create"),
    open: () => router.push("/designs"),
    makeCopy: () => void makeCopy(),
    rename: () => setRenaming(true),
    moveToFolder: () => setMoveOpen(true),
    designInfo: () => setInfoOpen(true),
    save: () => void saveNow(),
    download: () => setExportOpen(true),
    zoomIn: () => editor?.zoomTo(editor.getState().viewport.zoom * 1.25),
    zoomOut: () => editor?.zoomTo(editor.getState().viewport.zoom / 1.25),
    fit: () => editor?.fit(),
    fullscreen: () => void fullscreen.toggle().catch(() => toast({ message: "Fullscreen isn’t available right now." })),
    togglePanels: () => setPanelsHidden((hidden) => !hidden),
    shortcuts: () => setShortcutsOpen(true),
  };
  const actions = state && editor ? buildActions(state, editor.core, host) : null;

  const zoom = state?.viewport.zoom ?? 1;
  const artboard = state?.doc.artboard ?? design.doc.artboard;

  return (
    <main ref={root} className="flex h-svh flex-col overflow-hidden bg-bg text-text">
      <EditorHeader
        editor={editor}
        doc={state?.doc ?? design.doc}
        canUndo={state?.canUndo ?? false}
        canRedo={state?.canRedo ?? false}
        status={status}
        onRetry={() => void saver.current?.flush()}
        onResolve={() => setConflictOpen(true)}
        exportOpen={exportOpen}
        onExportOpenChange={setExportOpen}
        renaming={renaming}
        onRenamingChange={setRenaming}
        actions={actions}
        mac={mac}
      />

      <div className="flex min-h-0 flex-1">
        {!panelsHidden && <InsertRail editor={editor} />}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div ref={container} className="relative min-h-0 flex-1 overflow-hidden bg-bg2">
            <canvas ref={scene} className="absolute inset-0" aria-hidden />
            <canvas ref={overlay} className="absolute inset-0 touch-none" aria-label="Design canvas. Use the Layers panel to select layers with the keyboard." />
            {state && editor && <TextEditor editor={editor} state={state} />}
            {panelsHidden && (
              <button type="button" onClick={() => setPanelsHidden(false)} className="glass-btn glass-secondary absolute top-3 right-3 h-8 rounded-lg px-3 text-[13px]">
                <span className="glass-label">Show panels</span>
              </button>
            )}
          </div>
          {!panelsHidden && (
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
          )}
        </div>
        {!panelsHidden && (
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
        )}
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

      {actions && <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} actions={actions} mac={mac} />}
      <DesignInfoDialog open={infoOpen} onClose={() => setInfoOpen(false)} doc={state?.doc ?? design.doc} savedAt={savedAt} />
      <MoveDialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        designId={design.id}
        folderId={folderId}
        onMoved={(id, name) => {
          setFolderId(id);
          toast({ message: name ? `Moved to ${name}.` : "Removed from its folder." });
        }}
      />
    </main>
  );
}
