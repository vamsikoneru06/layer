import type { Doc } from "@vash/schema";
import { EditorCore, type EditorState } from "./editor-core";
import { fontRequests } from "./fonts";
import { createInteraction, type PointerInput } from "./interaction";
import { renderOverlay } from "./overlay";
import type { EditMode } from "./policy";
import { renderScene, type ImageState } from "./render";
import { handleKey } from "./shortcuts";
import type { Measure } from "./text";
import { fitViewport, zoomAt } from "./viewport";

export interface EditorOptions {
  /** Element the two canvases fill; its size drives the canvas size. */
  container: HTMLElement;
  scene: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  doc: Doc;
  mode?: EditMode;
  image?: (assetId: string) => ImageState;
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
  destroy(): void;
}

function canvasMeasure(): Measure {
  const ctx = document.createElement("canvas").getContext("2d")!;
  return (text, font, size) => {
    ctx.font = `${font.style} ${font.weight} ${size}px "${font.family}", system-ui, sans-serif`;
    return ctx.measureText(text).width;
  };
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

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

  const draw = () => {
    frame = 0;
    const s = core.getState();
    renderScene(sceneCtx, s.doc, s.viewport, { measure, image, dpr });
    renderOverlay(overlayCtx, s.doc, s.viewport, dpr, s);
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
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = o.overlay.getBoundingClientRect();
    ui.wheel({ x: e.clientX - r.left, y: e.clientY - r.top, deltaX: e.deltaX, deltaY: e.deltaY, zoom: e.ctrlKey || e.metaKey });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return;
    if (e.key === " ") {
      ui.setSpace(true);
      invalidate();
      e.preventDefault();
      return;
    }
    const mod = navigator.platform.startsWith("Mac") ? e.metaKey : e.ctrlKey;
    if (handleKey(core, { key: e.key, mod, shift: e.shiftKey, alt: e.altKey })) e.preventDefault();
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
  o.overlay.addEventListener("wheel", onWheel, { passive: false });
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
    destroy() {
      unsubscribe();
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      o.overlay.removeEventListener("pointerdown", onDown);
      o.overlay.removeEventListener("pointermove", onMove);
      o.overlay.removeEventListener("pointerup", onUp);
      o.overlay.removeEventListener("pointercancel", onCancel);
      o.overlay.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.fonts?.removeEventListener("loadingdone", onFonts);
    },
  };
}
