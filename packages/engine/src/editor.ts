import type { Doc, NodeId } from "@vash/schema";
import { EditorCore, type EditorState } from "./editor-core";
import { exportPng } from "./export";
import { createFilterRenderer, type FilterFn } from "./filters";
import { fontRequests } from "./fonts";
import { createInteraction, type PointerInput } from "./interaction";
import { renderOverlay } from "./overlay";
import type { EditMode } from "./policy";
import { renderScene, type ImageState } from "./render";
import { hitTest } from "./hit-test";
import { frameAt } from "./photos";
import { handleKey, type KeyInput } from "./shortcuts";
import type { Measure } from "./text";
import { textEditBox, type TextEditBox } from "./text-edit";
import { fitViewport, toWorld, zoomAt } from "./viewport";

export interface EditorOptions {
  /** Element the two canvases fill; its size drives the canvas size. */
  container: HTMLElement;
  scene: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  doc: Doc;
  mode?: EditMode;
  image?: (assetId: string) => ImageState;
  /** Resolves once the given photos have loaded (or failed), so export can wait for them. */
  imagesReady?: (assetIds: string[]) => Promise<void>;
}

export interface Editor {
  core: EditorCore;
  getState(): EditorState;
  subscribe(listener: () => void): () => void;
  /** Fit the artboard to the view. */
  fit(): void;
  /** Set zoom about the view centre (1 = 100%). */
  zoomTo(zoom: number): void;
  /** Redraw on the next frame (e.g. after fonts or images load). */
  invalidate(): void;
  /** The current document as a PNG at 1×/2×/3×. */
  exportPng(o: { scale: number; transparent: boolean }): Promise<Blob>;
  /** Placement of the on-canvas text box while a text layer is being edited. */
  textEditBox(): TextEditBox | null;
  /**
   * The frame a photo dropped at this point on screen would fill, outlined while dragging over it.
   * Pass null when the drag leaves or ends to clear the outline.
   */
  dropTarget(at: { clientX: number; clientY: number } | null): NodeId | null;
  destroy(): void;
}

function canvasMeasure(): Measure {
  const ctx = document.createElement("canvas").getContext("2d")!;
  return (text, font, size) => {
    ctx.font = `${font.style} ${font.weight} ${size}px "${font.family}", system-ui, sans-serif`;
    return ctx.measureText(text).width;
  };
}

/** The few element members the key guards read, so they run on plain objects in tests. */
export interface KeyTarget {
  isContentEditable?: boolean;
  tagName?: string;
  closest?: (selector: string) => unknown;
}

/** The members of a keydown event that make up a shortcut. */
export interface KeyEventLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * A key press as `handleKey` takes it. With Option held, macOS reports the character it types ("ç" for C),
 * so there a letter comes from the physical key (`code`) to let Option shortcuts match. Other platforms
 * keep `key`: on Windows and Linux Ctrl+Alt is AltGr, which types characters, and the physical key would
 * also be wrong on Dvorak or Colemak layouts.
 */
export function keyInputOf(e: KeyEventLike, mac: boolean): KeyInput {
  const letter = mac && e.altKey && !/^[a-z]$/i.test(e.key) ? /^Key([A-Z])$/.exec(e.code) : null;
  return { key: letter ? letter[1]!.toLowerCase() : e.key, mod: mac ? e.metaKey : e.ctrlKey, shift: e.shiftKey, alt: e.altKey };
}

/** The element a mouse press last focused; anything inside it still counts as mouse-focused. */
export interface PointerFocus {
  contains(other: unknown): boolean;
}

const CONTROL = "button, a[href], [role=button], summary";

/** Keys typed into a field, or pressed inside an open menu or dialog, belong to that field, menu or dialog. */
export const isTyping = (t: KeyTarget | null) => {
  if (!t || typeof t.closest !== "function") return false;
  return !!t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.closest("dialog") !== null || t.closest("[role=menu]") !== null;
};

/**
 * Enter and Space on a button, link or summary that has keyboard focus activate it, so the canvas must
 * not take them (Enter to edit text, Space to pan). Only for keyboard focus: after a mouse click focus
 * stays on the clicked button, and the canvas shortcuts must keep working then. The editor tracks the
 * mouse press itself (`pointerFocused`) because `:focus-visible` already reads true inside the first
 * keydown after a click in Chromium.
 */
export function activatesFocusedControl(t: KeyTarget | null, key: string, pointerFocused: PointerFocus | null = null): boolean {
  if ((key !== "Enter" && key !== " ") || !t || typeof t.closest !== "function") return false;
  if (t.closest(CONTROL) === null) return false;
  return !(pointerFocused && pointerFocused.contains(t));
}

/** Tab hands focus to the keyboard, so the mouse press no longer explains where focus is. */
export const pointerFocusAfterKey = (p: PointerFocus | null, key: string): PointerFocus | null => (key === "Tab" ? null : p);

/** Focus moving outside the pressed element is not the mouse press's doing either. */
export const pointerFocusAfterFocusIn = (p: PointerFocus | null, target: unknown): PointerFocus | null => (p && p.contains(target) ? p : null);

/**
 * Binds the engine to two stacked canvases: the design below, selection chrome above (which also
 * receives pointer input). Redraws at most once per animation frame, and only when state changed.
 */
export function createEditor(o: EditorOptions): Editor {
  const core = new EditorCore(o.doc, { mode: o.mode ?? "design" });
  const ui = createInteraction(core);
  const sceneCtx = o.scene.getContext("2d")!;
  const overlayCtx = o.overlay.getContext("2d")!;
  const image = o.image ?? (() => "loading" as const);
  let measure = canvasMeasure();
  let dpr = window.devicePixelRatio || 1;
  let size = { width: 0, height: 0 };
  let frame = 0;
  let fitted = false;

  // The WebGL2 filter pipeline starts on first use, so designs without filtered photos never create a context.
  let filters: ReturnType<typeof createFilterRenderer> | null = null;
  let warned = false;
  const filter: FilterFn = (source, width, height, f) => {
    filters ??= createFilterRenderer({ onRestored: () => invalidate() });
    const out = filters.apply(source, width, height, f);
    if (!out && !filters.available && !warned) {
      warned = true;
      queueMicrotask(() => core.setChrome({ notice: "Photo filters aren't available in this browser, so photos show without them." }));
    }
    return out;
  };

  const draw = () => {
    frame = 0;
    const s = core.getState();
    renderScene(sceneCtx, s.doc, s.viewport, { measure, image, filter, dpr, hidden: s.editing });
    // While typing, the text box is the chrome: outline only, no handles.
    renderOverlay(overlayCtx, s.doc, s.viewport, dpr, { ...s, dragging: s.dragging || s.editing !== null });
    o.overlay.style.cursor = ui.cursor();
  };
  const invalidate = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  const fit = () => core.setChrome({ viewport: fitViewport(size, core.doc.artboard) });

  // Ask for every font the document uses once; when one arrives, text is measured again.
  const requested = new Set<string>();
  const loadFonts = () => {
    for (const font of fontRequests(core.doc)) {
      if (requested.has(font) || !document.fonts) continue;
      requested.add(font);
      document.fonts.load(font).then(onFonts, () => {});
    }
  };

  const resize = () => {
    const r = o.container.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    size = { width: r.width, height: r.height };
    for (const c of [o.scene, o.overlay]) {
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
    }
    if (!fitted && r.width > 0 && r.height > 0) {
      fitted = true;
      fit();
    }
    invalidate();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(o.container);
  resize();

  const input = (e: PointerEvent | MouseEvent): PointerInput => {
    const r = o.overlay.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, button: e.button, shift: e.shiftKey, alt: e.altKey };
  };
  const onDown = (e: PointerEvent) => {
    // A press anywhere on the canvas ends typing before it does anything else.
    core.endTextEdit(true);
    o.overlay.setPointerCapture(e.pointerId);
    ui.pointerDown(input(e));
    invalidate();
  };
  const onMove = (e: PointerEvent) => {
    ui.pointerMove(input(e));
    invalidate();
  };
  const onUp = (e: PointerEvent) => {
    ui.pointerUp(input(e));
    invalidate();
  };
  const onCancel = () => ui.cancel();
  // Double-clicking text (even inside a group) starts typing into it.
  const onDoubleClick = (e: MouseEvent) => {
    const hit = hitTest(core.doc, toWorld(core.getState().viewport, input(e)));
    const type = hit ? core.doc.nodes[hit]?.type : undefined;
    if (type === "text") core.startTextEdit(hit!);
    // Double-clicking a photo lets you move and zoom it inside its frame.
    else if (type === "frame") core.startCrop(hit!);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = o.overlay.getBoundingClientRect();
    ui.wheel({ x: e.clientX - r.left, y: e.clientY - r.top, deltaX: e.deltaX, deltaY: e.deltaY, zoom: e.ctrlKey || e.metaKey });
  };
  // A press on a button focuses it without keyboard focus; remember it so Space and Enter still reach the canvas.
  let pointerFocused: PointerFocus | null = null;
  const onPointerDownCapture = (e: PointerEvent) => {
    const t = e.target as (KeyTarget & Partial<PointerFocus>) | null;
    pointerFocused = t && typeof t.contains === "function" ? (((t.closest?.(CONTROL) as PointerFocus | null | undefined) ?? t) as PointerFocus) : null;
  };
  const onFocusIn = (e: FocusEvent) => {
    pointerFocused = pointerFocusAfterFocusIn(pointerFocused, e.target);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    pointerFocused = pointerFocusAfterKey(pointerFocused, e.key);
    const target = e.target as KeyTarget | null;
    if (isTyping(target) || activatesFocusedControl(target, e.key, pointerFocused)) return;
    if (e.key === " ") {
      ui.setSpace(true);
      invalidate();
      e.preventDefault();
      return;
    }
    if (core.getState().cropping && (e.key === "Enter" || e.key === "Escape")) {
      core.endCrop();
      e.preventDefault();
      return;
    }
    if (e.getModifierState?.("AltGraph")) return; // AltGr types a character, it is not a shortcut
    if (handleKey(core, keyInputOf(e, navigator.platform.startsWith("Mac")))) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " ") {
      ui.setSpace(false);
      invalidate();
    }
  };
  // Text laid out with a fallback font must be measured again once the real font arrives.
  const onFonts = () => {
    measure = canvasMeasure();
    invalidate();
  };

  o.overlay.addEventListener("pointerdown", onDown);
  o.overlay.addEventListener("pointermove", onMove);
  o.overlay.addEventListener("pointerup", onUp);
  o.overlay.addEventListener("pointercancel", onCancel);
  o.overlay.addEventListener("dblclick", onDoubleClick);
  o.overlay.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("pointerdown", onPointerDownCapture, true);
  window.addEventListener("focusin", onFocusIn);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  document.fonts?.addEventListener("loadingdone", onFonts);
  const unsubscribe = core.subscribe(() => {
    loadFonts();
    invalidate();
  });
  loadFonts();

  return {
    core,
    getState: core.getState,
    subscribe: core.subscribe,
    fit,
    zoomTo: (zoom) => core.setChrome({ viewport: zoomAt(core.getState().viewport, { x: size.width / 2, y: size.height / 2 }, zoom) }),
    invalidate,
    exportPng: (e) => exportPng(core.doc, { ...e, measure, image, imagesReady: o.imagesReady, filter }),
    dropTarget: (at) => {
      let id: NodeId | null = null;
      if (at) {
        const r = o.overlay.getBoundingClientRect();
        id = frameAt(core.doc, toWorld(core.getState().viewport, { x: at.clientX - r.left, y: at.clientY - r.top }));
      }
      if (core.getState().hover !== id) core.setChrome({ hover: id });
      return id;
    },
    textEditBox: () => {
      const s = core.getState();
      return s.editing ? textEditBox(s.doc, s.editing, s.viewport, measure) : null;
    },
    destroy() {
      unsubscribe();
      observer.disconnect();
      filters?.destroy();
      if (frame) cancelAnimationFrame(frame);
      o.overlay.removeEventListener("pointerdown", onDown);
      o.overlay.removeEventListener("pointermove", onMove);
      o.overlay.removeEventListener("pointerup", onUp);
      o.overlay.removeEventListener("pointercancel", onCancel);
      o.overlay.removeEventListener("dblclick", onDoubleClick);
      o.overlay.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerdown", onPointerDownCapture, true);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.fonts?.removeEventListener("loadingdone", onFonts);
    },
  };
}
