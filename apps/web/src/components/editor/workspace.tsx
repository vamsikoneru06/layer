"use client";

import { copiedStyleOf, createEditor, hitTest, resizeDesign, toWorld, topLevelOf, type Editor, type EditorState, type Measure } from "@vash/engine";
import { parseDoc, type Doc } from "@vash/schema";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { duplicateDesign, getDesign, restoreVersion, saveDesign, saveDesignAsCopy, type Design } from "@/lib/api";
import { addGuide, loadGuides, loadView, moveGuide, removeGuide, saveGuides, saveView, toDesign, type GuideAxis, type Guides, type ViewSettings } from "@/lib/guides";
import { copyLocalDesign, localDesigns } from "@/lib/local-designs";
import { createAutosaver, type Autosaver, type SaveStatus } from "@/lib/autosave";
import { createImageLoader } from "@/lib/images";
import { BottomBar } from "./bottom-bar";
import { CanvasOverlay } from "./canvas-overlay";
import { DesignInfoDialog } from "./design-info-dialog";
import { ContextMenu } from "./context-menu";
import { ResizeDialog } from "./resize-dialog";
import { buildActions, CONTEXT_LAYOUTS, toMenuItems, type ActionHost } from "./editor-actions";
import { EditorHeader } from "./editor-header";
import { FloatingToolbar } from "./floating-toolbar";
import { Segmented } from "./fields";
import { InsertRail } from "./insert-rail";
import { Ruler, RULER_THICKNESS } from "./ruler";
import { SaveToAccount } from "./save-to-account";
import { usePhotoDrop } from "./use-photo-drop";
import { LayersPanel } from "./layers-panel";
import { MoveDialog } from "./move-dialog";
import { PropertiesPanel } from "./properties-panel";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { TextEditor } from "./text-editor";
import { useClipboard } from "./use-clipboard";
import { useElementSize } from "./use-element-size";
import { useFullscreen } from "./use-fullscreen";
import { VersionHistoryPanel } from "./version-history-panel";
// Self-hosted allowlisted fonts, loaded only on the editor route.
import "./fonts.css";

const NO_EDITOR = { subscribe: () => () => {}, get: () => null };

/** Where a key press is typed into a field, or belongs to a dialog or menu, so it is not a canvas shortcut. */
const TYPING_OR_MODAL = "input, textarea, select, [contenteditable]:not([contenteditable=false]), dialog, [role=dialog], [role=menu]";

function useEditorState(editor: Editor | null): EditorState | null {
  return useSyncExternalStore(editor ? editor.subscribe : NO_EDITOR.subscribe, editor ? editor.getState : NO_EDITOR.get, NO_EDITOR.get);
}

/** Saves a design kept on this device; versions count up locally so the autosaver works the same. */
const saveLocal = (id: string) => async (doc: Doc, version: number) => {
  await localDesigns.put({ id, doc, version: version + 1, updatedAt: new Date().toISOString() });
  return version + 1;
};

let measureContext: CanvasRenderingContext2D | null = null;
/** Text widths for the version previews, measured as the editor measures them (the engine's own measure is not exported). */
const measure: Measure = (text, font, size) => {
  measureContext ??= document.createElement("canvas").getContext("2d")!;
  measureContext.font = `${font.style} ${font.weight} ${size}px "${font.family}", system-ui, sans-serif`;
  return measureContext.measureText(text).width;
};

export function Workspace({ design, local = false }: { design: Design; local?: boolean }) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const saver = useRef<Autosaver<Doc> | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  // Written where the status is produced, so async code that resumes after `flush()` sees it before React re-renders.
  const statusRef = useRef<SaveStatus>("saved");
  const [panel, setPanel] = useState<"properties" | "layers">("properties");
  const [conflictOpen, setConflictOpen] = useState(true);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Set by an explicit save (Ctrl+S, File > Save) so the server keeps the replaced content as a version.
  const checkpointNext = useRef(false);
  // The photo loader of the open design, for the version previews.
  const photos = useRef<ReturnType<typeof createImageLoader> | null>(null);
  const state = useEditorState(editor);
  const toast = useToast();
  const clipboard = useClipboard(editor);
  const fullscreen = useFullscreen();
  const [infoOpen, setInfoOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [resizeOpen, setResizeOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; onLayer: boolean } | null>(null);
  const [panelsHidden, setPanelsHidden] = useState(false);
  const [savedAt, setSavedAt] = useState(design.updatedAt);
  const [folderId, setFolderId] = useState(design.folderId);
  const [view, setView] = useState<ViewSettings>(loadView);
  // Guides belong to one design. The state records which, so opening another design loads its guides.
  const [guideState, setGuideState] = useState(() => ({ designId: design.id, guides: loadGuides(design.id) }));
  if (guideState.designId !== design.id) setGuideState({ designId: design.id, guides: loadGuides(design.id) });
  const guides = guideState.guides;
  const setGuides = (change: (g: Guides) => Guides) => setGuideState((s) => ({ designId: s.designId, guides: change(s.guides) }));
  const guideCount = guides.x.length + guides.y.length;
  const size = useElementSize(container);
  const mac = useMemo(() => typeof navigator !== "undefined" && navigator.platform.startsWith("Mac"), []);

  useEffect(() => saveView(view), [view]);
  useEffect(() => saveGuides(guideState.designId, guideState.guides), [guideState]);
  // The engine snaps to guides only while they are shown and snapping to them is on.
  useEffect(() => {
    editor?.core.setSnapOptions({ objects: view.snapObjects, guides: view.snapGuides && view.guides ? guides : { x: [], y: [] } });
  }, [editor, view, guides]);

  useEffect(() => {
    // Photos load in the background; the canvas redraws as each arrives.
    let e: Editor | null = null;
    const images = createImageLoader(() => e?.invalidate());
    photos.current = images;
    e = createEditor({ container: container.current!, scene: scene.current!, overlay: overlay.current!, doc: design.doc, image: images.image, imagesReady: images.ready });
    setEditor(e);
    const s = createAutosaver<Doc>({
      version: design.version,
      delayMs: 1500,
      retryMs: 5000,
      save: local
        ? saveLocal(design.id)
        : (doc, v) => {
            const checkpoint = checkpointNext.current;
            checkpointNext.current = false;
            return saveDesign(design.id, doc, v, checkpoint);
          },
      onStatus: (st) => {
        statusRef.current = st;
        setStatus(st);
      },
    });
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
  }, [design, local]);

  const photoDrop = usePhotoDrop(editor);

  // Refusals ("This layer is locked. Unlock it to change it.") and other engine messages show as a toast, then clear.
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

  /** Replaces the design with an earlier version. The server keeps what it replaces, so the restore can be undone. */
  const restore = async (versionId: string) => {
    const s = saver.current;
    if (!editor || !s) return;
    await s.flush();
    if (s.dirty) throw new Error("Your latest changes are still saving. Try again in a moment.");
    const restored = await restoreVersion(design.id, versionId, s.version);
    // The same validation as on first open; never hand the engine a malformed document.
    const parsed = parseDoc(restored.doc, { kind: "design" });
    if (!parsed.ok) throw new Error("This version couldn’t be opened.");
    editor.core.endTextEdit(false);
    editor.core.history.reset(parsed.doc);
    s.reset(restored.version);
    setHistoryOpen(false);
    toast({ message: "Version restored.", duration: 3000 });
  };

  /** Photos for the version previews. The loader redraws the canvas as photos arrive, so a preview may need a redraw to show them. */
  const previewImage = (assetId: string) => photos.current?.image(assetId) ?? "missing";

  // When a save finishes, "Last saved" in Design info moves on.
  const wasSaved = useRef(true);
  useEffect(() => {
    if (status === "saved" && !wasSaved.current) setSavedAt(new Date().toISOString());
    wasSaved.current = status === "saved";
  }, [status]);

  const saveInProgress = () => statusRef.current === "saving" || statusRef.current === "unsaved";

  /** Saves now. `flush` never throws and returns at once if a save is already running, so a leftover `dirty` needs the status to tell progress from failure. */
  async function saveNow() {
    const s = saver.current;
    if (!s) return;
    // Only when something is pending: a checkpoint with nothing to save would otherwise ride on the next autosave.
    if (s.dirty) checkpointNext.current = true;
    await s.flush();
    const message =!s.dirty ? "All changes saved." : saveInProgress() ? "Saving your changes." : "Not saved yet. The status at the top shows why.";
    toast({ message, duration: 3000 });
  }

  async function makeCopy() {
    const s = saver.current;
    try {
      if (s?.dirty) await s.flush();
      if (s?.dirty) {
        toast({
          message: saveInProgress()
            ? "Your latest changes are still saving. Try again in a moment."
            : "Your latest changes could not be saved, so the copy would miss them. Check the status at the top.",
        });
        return;
      }
      // A design kept in this browser is copied in this browser.
      const copy = local ? await copyLocalDesign(localDesigns, design.id) : await duplicateDesign(design.id);
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

  // Shift+R shows or hides the rulers, unless the key is typed into a field, a dialog or a menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "r" || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest(TYPING_OR_MODAL)) return;
      setView((v) => ({ ...v, rulers: !v.rulers }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Dragging out of a ruler makes a guide that follows the pointer while it is over the canvas. Released outside the canvas, over its ruler, it is removed. */
  const startGuide = (axis: GuideAxis, e: ReactPointerEvent) => {
    const el = container.current;
    if (!editor || !el || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pointerId = e.pointerId;
    // Distance from the canvas edge on the guide's side. Negative means outside the canvas.
    const along = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return axis === "y" ? y - r.top : x - r.left;
    };
    const designAt = (pos: number) => {
      const vp = editor.getState().viewport;
      return toDesign(pos, vp.zoom, axis === "y" ? vp.panY : vp.panX);
    };
    const index = guides[axis].length;
    setGuides((g) => addGuide(g, axis, designAt(along(e.clientX, e.clientY))));
    if (!view.guides) setView((v) => ({ ...v, guides: true }));

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const pos = along(ev.clientX, ev.clientY);
      if (pos >= 0) setGuides((g) => moveGuide(g, axis, index, designAt(pos)));
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (along(ev.clientX, ev.clientY) < 0) setGuides((g) => removeGuide(g, axis, index));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  // Right-click selects the layer under the pointer (unless it is already selected) and opens the menu.
  useEffect(() => {
    const el = overlay.current;
    if (!el || !editor) return;
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      editor.core.endTextEdit(true);
      const rect = el.getBoundingClientRect();
      const s = editor.getState();
      const hit = hitTest(s.doc, toWorld(s.viewport, { x: e.clientX - rect.left, y: e.clientY - rect.top }));
      if (hit) {
        const top = topLevelOf(s.doc, hit);
        if (!s.selection.includes(hit) && !s.selection.includes(top)) editor.core.select([top]);
      } else {
        editor.core.select([]);
      }
      setMenuAt({ x: e.clientX, y: e.clientY, onLayer: hit !== null });
    };
    el.addEventListener("contextmenu", onContext);
    return () => el.removeEventListener("contextmenu", onContext);
  }, [editor]);

  // The canvas area changes size when panels hide or fullscreen starts: fit once the layout has settled.
  useEffect(() => {
    if (!editor) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => editor.fit()));
    return () => cancelAnimationFrame(frame);
  }, [editor, panelsHidden, fullscreen.active]);

  // The latest host. The actions below are memoised, so their host methods go through this ref and never run a stale closure.
  const toggleView = (key: keyof ViewSettings) => setView((v) => ({ ...v, [key]: !v[key] }));
  const latestHost: Omit<ActionHost, "panelsHidden" | "canFullscreen" | "local" | "view" | "guideCount"> = {
    copy: () => void clipboard.copy(),
    cut: () => void clipboard.cut(),
    paste: () => void clipboard.paste(),
    newDesign: () => router.push("/home#create"),
    open: () => router.push("/designs"),
    makeCopy: () => void makeCopy(),
    rename: () => setRenaming(true),
    moveToFolder: () => setMoveOpen(true),
    designInfo: () => setInfoOpen(true),
    // The panel lives in the side panel, so opening it shows that panel again.
    versionHistory: () => {
      setPanelsHidden(false);
      setHistoryOpen(true);
    },
    resizeDesign: () => setResizeOpen(true),
    save: () => void saveNow(),
    download: () => setExportOpen(true),
    zoomIn: () => editor?.zoomTo(editor.getState().viewport.zoom * 1.25),
    zoomOut: () => editor?.zoomTo(editor.getState().viewport.zoom / 1.25),
    fit: () => editor?.fit(),
    actualSize: () => editor?.zoomTo(1),
    fullscreen: () => void fullscreen.toggle().catch(() => toast({ message: "Fullscreen isn’t available right now." })),
    togglePanels: () => setPanelsHidden((hidden) => !hidden),
    shortcuts: () => setShortcutsOpen(true),
    toggleRulers: () => toggleView("rulers"),
    toggleGuides: () => toggleView("guides"),
    toggleGrid: () => toggleView("grid"),
    toggleSnapObjects: () => toggleView("snapObjects"),
    toggleSnapGuides: () => toggleView("snapGuides"),
    clearGuides: () => setGuides(() => ({ x: [], y: [] })),
  };
  const hostRef = useRef(latestHost);
  hostRef.current = latestHost;
  const host = useMemo<ActionHost>(() => {
    const call = (name: keyof typeof latestHost) => () => hostRef.current[name]();
    return {
      panelsHidden,
      canFullscreen: fullscreen.supported,
      local,
      copy: call("copy"),
      cut: call("cut"),
      paste: call("paste"),
      newDesign: call("newDesign"),
      open: call("open"),
      makeCopy: call("makeCopy"),
      rename: call("rename"),
      moveToFolder: call("moveToFolder"),
      designInfo: call("designInfo"),
      versionHistory: call("versionHistory"),
      resizeDesign: call("resizeDesign"),
      save: call("save"),
      download: call("download"),
      zoomIn: call("zoomIn"),
      zoomOut: call("zoomOut"),
      fit: call("fit"),
      actualSize: call("actualSize"),
      fullscreen: call("fullscreen"),
      togglePanels: call("togglePanels"),
      shortcuts: call("shortcuts"),
      view,
      guideCount,
      toggleRulers: call("toggleRulers"),
      toggleGuides: call("toggleGuides"),
      toggleGrid: call("toggleGrid"),
      toggleSnapObjects: call("toggleSnapObjects"),
      toggleSnapGuides: call("toggleSnapGuides"),
      clearGuides: call("clearGuides"),
    };
  }, [panelsHidden, fullscreen.supported, local, view, guideCount]);

  // Ctrl or Cmd with = + - 0 1 zooms the canvas instead of the page. Keys typed into a field or a dialog are left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(mac ? e.metaKey : e.ctrlKey) || e.altKey) return;
      if (e.target instanceof Element && e.target.closest(TYPING_OR_MODAL)) return;
      const zoom = hostRef.current;
      switch (e.key) {
        case "=":
        case "+":
          zoom.zoomIn();
          break;
        case "-":
          zoom.zoomOut();
          break;
        case "0":
          zoom.fit();
          break;
        case "1":
          zoom.actualSize();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mac]);

  // Hover, viewport and marquee changes rebuild the state but not these inputs, so they do not rebuild the actions.
  const doc = state?.doc;
  const selection = state?.selection;
  const mode = state?.mode;
  const canUndo = state?.canUndo;
  const canRedo = state?.canRedo;
  const zoomLevel = state?.viewport.zoom;
  const copiedStyle = editor ? copiedStyleOf(editor.core) : null;
  const actions = useMemo(
    () =>
      editor && doc && selection && mode && zoomLevel !== undefined
        ? buildActions({ doc, selection, mode, canUndo: !!canUndo, canRedo: !!canRedo, viewport: { zoom: zoomLevel } }, editor.core, host)
        : null,
    [editor, doc, selection, mode, canUndo, canRedo, zoomLevel, copiedStyle, host],
  );

  const zoom = zoomLevel ?? 1;
  const artboard = state?.doc.artboard ?? design.doc.artboard;

  return (
    <main className="flex h-svh flex-col overflow-hidden bg-bg text-text">
      <EditorHeader
        editor={editor}
        doc={state?.doc ?? design.doc}
        canUndo={state?.canUndo ?? false}
        canRedo={state?.canRedo ?? false}
        status={status}
        local={local}
        onRetry={() => void saver.current?.flush()}
        onResolve={() => setConflictOpen(true)}
        exportOpen={exportOpen}
        onExportOpenChange={setExportOpen}
        renaming={renaming}
        onRenamingChange={setRenaming}
        actions={actions}
        mac={mac}
        saveToAccount={local ? <SaveToAccount id={design.id} saver={saver} /> : null}
      />

      <div className="flex min-h-0 flex-1">
        {!panelsHidden && <InsertRail editor={editor} />}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {view.rulers && state && (
            <div className="flex flex-none">
              <div aria-hidden className="flex-none bg-bg2" style={{ width: RULER_THICKNESS, height: RULER_THICKNESS }} />
              <Ruler axis="x" viewport={state.viewport} length={size.width} page={{ start: 0, end: artboard.width }} onGuideStart={(e) => startGuide("y", e)} />
            </div>
          )}
          <div className="flex min-h-0 flex-1">
            {view.rulers && state && (
              <Ruler axis="y" viewport={state.viewport} length={size.height} page={{ start: 0, end: artboard.height }} onGuideStart={(e) => startGuide("x", e)} />
            )}
            <div ref={container} {...photoDrop} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-bg2">
              <canvas ref={scene} className="absolute inset-0" aria-hidden />
              <canvas ref={overlay} tabIndex={-1} className="absolute inset-0 touch-none outline-none" aria-label="Design canvas. Use the Layers panel to select layers with the keyboard." />
              {state && (
                <CanvasOverlay
                  viewport={state.viewport}
                  size={size}
                  page={{ width: artboard.width, height: artboard.height }}
                  guides={guides}
                  showGuides={view.guides}
                  showGrid={view.grid}
                  onMoveGuide={(axis, index, at) => setGuides((g) => moveGuide(g, axis, index, at))}
                  onRemoveGuide={(axis, index) => setGuides((g) => removeGuide(g, axis, index))}
                />
              )}
              {state && editor && <TextEditor editor={editor} state={state} />}
              {state && editor && actions && <FloatingToolbar core={editor.core} state={state} actions={actions} mac={mac} container={container} focusCanvas={() => overlay.current?.focus()} />}
              {panelsHidden && (
                <button type="button" onClick={() => setPanelsHidden(false)} className="glass-btn glass-secondary absolute top-3 right-3 h-8 rounded-lg px-3 text-[13px]">
                  <span className="glass-label">Show panels</span>
                </button>
              )}
            </div>
          </div>
          {!panelsHidden && <BottomBar editor={editor} zoom={zoom} size={artboard} actions={actions} />}
        </div>
        {!panelsHidden && (
          <aside className="flex w-[288px] flex-none flex-col border-l-[.5px] border-line text-[13px]" aria-label="Design panel">
            {historyOpen ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <VersionHistoryPanel
                  designId={design.id}
                  local={local}
                  currentVersion={saver.current?.version ?? design.version}
                  measure={measure}
                  image={previewImage}
                  onRestore={restore}
                  onClose={() => setHistoryOpen(false)}
                />
                {local && (
                  <div className="px-4 pt-3 pb-4">
                    <SaveToAccount id={design.id} saver={saver} />
                  </div>
                )}
              </div>
            ) : (
              <>
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
                {state && editor && actions && panel === "properties" && (
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                    <PropertiesPanel state={state} core={editor.core} actions={actions} mac={mac} />
                  </div>
                )}
                {state && editor && panel === "layers" && <LayersPanel state={state} core={editor.core} />}
              </>
            )}
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

      {actions && (
        <ContextMenu
          at={menuAt}
          items={toMenuItems(actions, menuAt?.onLayer ? CONTEXT_LAYOUTS.node : CONTEXT_LAYOUTS.canvas, mac)}
          onClose={() => setMenuAt(null)}
        />
      )}
      {actions && <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} actions={actions} mac={mac} />}
      <DesignInfoDialog open={infoOpen} onClose={() => setInfoOpen(false)} doc={state?.doc ?? design.doc} savedAt={savedAt} />
      <ResizeDialog
        open={resizeOpen}
        onClose={() => setResizeOpen(false)}
        doc={state?.doc ?? design.doc}
        mode={state?.mode ?? "design"}
        onResize={(size, scaleContent) => !!editor && resizeDesign(editor.core, size, scaleContent)}
      />
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
