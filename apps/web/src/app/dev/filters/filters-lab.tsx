"use client";

import { createEditor, type Editor, type EditorState, type LoadedImage } from "@vash/engine";
import { createEmptyDoc, defaultFilters, type Doc } from "@vash/schema";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PropertiesPanel } from "@/components/editor/properties-panel";
import { Button } from "@/components/ui/button";

const PHOTO = "/images/stream/5.jpg";
const STEPS = 90;

function labDoc(): Doc {
  const doc = createEmptyDoc({ id: "lab", kind: "design", title: "Filters lab", format: "ig-post" });
  doc.nodes.photo = {
    id: "photo",
    name: "Photo",
    type: "frame",
    transform: { x: 540, y: 540, rotation: 0, scaleX: 1, scaleY: 1 },
    width: 960,
    height: 960,
    opacity: 1,
    visible: true,
    lock: "free",
    shape: { kind: "rect", cornerRadius: 24 },
    content: { assetId: "sample", offsetX: 0, offsetY: 0, scale: 1 },
    filters: defaultFilters(),
    placeholder: false,
  };
  doc.root = ["photo"];
  return doc;
}

const NONE = { subscribe: () => () => {}, get: () => null };

export function FiltersLab() {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const state = useSyncExternalStore<EditorState | null>(editor ? editor.subscribe : NONE.subscribe, editor ? editor.getState : NONE.get, NONE.get);

  useEffect(() => {
    let photo: LoadedImage | null = null;
    const e = createEditor({
      container: container.current!,
      scene: scene.current!,
      overlay: overlay.current!,
      doc: labDoc(),
      image: () => photo ?? "loading",
    });
    let alive = true;
    void fetch(PHOTO)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
      .then((bitmap) => {
        if (!alive) return;
        photo = { source: bitmap, width: bitmap.width, height: bitmap.height };
        e.invalidate();
      });
    e.core.select(["photo"]);
    setEditor(e);
    // Dev page only: lets a browser console or test script drive the lab.
    (window as unknown as { lab?: Editor }).lab = e;
    return () => {
      alive = false;
      e.destroy();
    };
  }, []);

  /** Drags the Saturation slider from −1 to 1 over STEPS frames and reports frame intervals. */
  async function run() {
    if (!editor) return;
    const core = editor.core;
    const start = core.doc.nodes.photo;
    if (start?.type !== "frame") return;
    const frames: number[] = [];
    core.beginTransaction();
    let last = await new Promise<number>((r) => requestAnimationFrame(r));
    for (let i = 0; i <= STEPS; i++) {
      core.preview({ type: "update", id: "photo", patch: { filters: { ...start.filters, preset: null, saturation: -1 + (2 * i) / STEPS } } });
      const now = await new Promise<number>((r) => requestAnimationFrame(r));
      frames.push(now - last);
      last = now;
    }
    core.cancelTransaction();
    frames.sort((a, b) => a - b);
    const p95 = frames[Math.floor(frames.length * 0.95)]!;
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    setResult(`${STEPS} slider steps: average ${avg.toFixed(1)} ms per frame, p95 ${p95.toFixed(1)} ms (budget: one frame, ~16.7 ms at 60 Hz).`);
  }

  return (
    <main className="flex h-svh bg-bg text-text">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b-[.5px] border-line p-3 text-sm">
          <strong>Filters lab</strong>
          <Button size="sm" variant="secondary" onClick={() => void run()} disabled={!editor}>
            Time a slider drag
          </Button>
          {result && <span role="status">{result}</span>}
        </div>
        <div ref={container} className="relative min-h-0 flex-1 bg-bg2">
          <canvas ref={scene} className="absolute inset-0" aria-hidden />
          <canvas ref={overlay} className="absolute inset-0" aria-hidden />
        </div>
      </div>
      <aside className="w-[288px] flex-none overflow-y-auto border-l-[.5px] border-line p-4 text-[13px]" aria-label="Properties">
        {state && editor && <PropertiesPanel state={state} core={editor.core} />}
      </aside>
    </main>
  );
}
