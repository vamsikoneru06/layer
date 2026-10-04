"use client";

import { createInteraction, EditorCore, fitViewport, renderOverlay, renderScene, type Measure } from "@vash/engine";
import { createEmptyDoc, defaultFilters, type Doc, type Node } from "@vash/schema";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const LAYERS = 150;
const STEPS = 120;
const BUDGET_MS = 16;

/** Deterministic pseudo-random numbers, so every run draws the same scene. */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function benchDoc(): Doc {
  const doc = createEmptyDoc({ id: "bench", kind: "design", title: "Benchmark", format: "ig-story" });
  const r = rng(42);
  const base = (i: number) => ({
    id: `n${i}`,
    name: `Layer ${i}`,
    transform: { x: 60 + r() * 960, y: 60 + r() * 1800, rotation: r() < 0.3 ? r() * 90 - 45 : 0, scaleX: 1, scaleY: 1 },
    width: 60 + r() * 300,
    height: 40 + r() * 200,
    opacity: r() < 0.2 ? 0.7 : 1,
    visible: true,
    lock: "free" as const,
  });
  const colour = () => `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
  for (let i = 0; i < LAYERS; i++) {
    const kind = i % 5;
    let node: Node;
    if (kind === 0 || kind === 1) {
      const shapes = [{ kind: "rect", cornerRadius: 16 }, { kind: "ellipse" }, { kind: "polygon", sides: 6 }] as const;
      node = { ...base(i), type: "shape", geometry: shapes[i % 3]!, fill: { type: "solid", color: colour() }, stroke: i % 4 === 0 ? { color: "#1D1D1F", width: 4 } : null };
    } else if (kind === 2 || kind === 3) {
      node = {
        ...base(i),
        type: "text",
        content: "Weekend sale on everything in store",
        font: { family: "Inter", weight: 600, style: "normal" },
        size: 40,
        color: colour(),
        align: "center",
        lineHeight: 1.2,
        letterSpacing: 0,
        fit: "shrink",
        maxChars: null,
      };
    } else {
      node = { ...base(i), type: "frame", shape: { kind: "rect", cornerRadius: 24 }, content: null, filters: defaultFilters(), placeholder: true };
    }
    doc.nodes[node.id] = node;
    doc.root.push(node.id);
  }
  return doc;
}

interface Result {
  mode: string;
  p50: number;
  p95: number;
  max: number;
  mean: number;
  /** Frame mode only: frames that took longer than 1.5 × 16.7 ms (visibly dropped). */
  dropped: number | null;
  pass: boolean;
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;

function summarise(mode: string, samples: number[], dropped: number | null): Result {
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  // Work must fit the frame; real frames arrive every ~16.7 ms at 60 Hz, so they pass when (almost) none are dropped.
  const pass = dropped === null ? p95 <= BUDGET_MS : dropped <= Math.floor(samples.length * 0.01);
  return { mode, p50: percentile(sorted, 0.5), p95, max: sorted.at(-1)!, mean: samples.reduce((a, b) => a + b, 0) / samples.length, dropped, pass };
}

export function Bench() {
  const scene = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);

  /** A fresh 150-layer scene with a drag in progress on the middle layer. */
  function setup() {
    const width = 1200;
    const height = 800;
    const dpr = window.devicePixelRatio || 1;
    for (const c of [scene.current!, overlay.current!]) {
      c.width = width * dpr;
      c.height = height * dpr;
      c.style.width = `${width}px`;
      c.style.height = `${height}px`;
    }
    const sceneCtx = scene.current!.getContext("2d")!;
    const overlayCtx = overlay.current!.getContext("2d")!;
    const measureCtx = document.createElement("canvas").getContext("2d")!;
    const measure: Measure = (text, font, size) => {
      measureCtx.font = `${font.style} ${font.weight} ${size}px "${font.family}", system-ui, sans-serif`;
      return measureCtx.measureText(text).width;
    };
    const doc = benchDoc();
    const core = new EditorCore(doc);
    const ui = createInteraction(core);
    const viewport = fitViewport({ width, height }, doc.artboard, 24);
    core.setChrome({ viewport });
    const draw = () => {
      const s = core.getState();
      renderScene(sceneCtx, s.doc, s.viewport, { measure, image: () => "loading", dpr });
      renderOverlay(overlayCtx, s.doc, s.viewport, dpr, s);
    };
    draw(); // warm caches the way a real session would be warm
    const target = doc.nodes[`n${Math.floor(LAYERS / 2)}`]!;
    const start = { x: target.transform.x * viewport.zoom + viewport.panX, y: target.transform.y * viewport.zoom + viewport.panY };
    const pointer = (i: number) => ({ x: start.x + Math.sin(i / 10) * 200, y: start.y + Math.cos(i / 13) * 150, button: 0, shift: false, alt: false });
    ui.pointerDown(pointer(0));
    return { ui, draw, pointer };
  }

  /** CPU cost of one frame: pointer handling, document update and both redraws, measured synchronously. */
  function measureWork() {
    const { ui, draw, pointer } = setup();
    const times: number[] = [];
    for (let i = 1; i <= STEPS; i++) {
      const t0 = performance.now();
      ui.pointerMove(pointer(i));
      draw();
      times.push(performance.now() - t0);
    }
    ui.pointerUp(pointer(STEPS));
    setResult(summarise("work per frame (CPU)", times, null));
  }

  /** Real frame intervals: one drag step per animation frame, including the browser's own raster/composite. Needs a visible window. */
  function measureFrames() {
    const { ui, draw, pointer } = setup();
    setRunning(true);
    const intervals: number[] = [];
    let last = 0;
    let i = 0;
    const frame = (now: number) => {
      if (last) intervals.push(now - last);
      last = now;
      if (i++ >= STEPS) {
        ui.pointerUp(pointer(STEPS));
        setRunning(false);
        setResult(summarise("frame interval", intervals, intervals.filter((t) => t > 25).length));
        return;
      }
      ui.pointerMove(pointer(i));
      draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  const fmt = (ms: number) => `${ms.toFixed(2)} ms`;
  return (
    <main className="flex min-h-svh flex-col gap-6 bg-bg p-8 text-text">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Engine benchmark</h1>
        <Button onClick={measureWork} disabled={running}>
          Measure work
        </Button>
        <Button variant="secondary" onClick={measureFrames} loading={running}>
          {running ? "Measuring…" : "Measure frames"}
        </Button>
      </div>
      <p className="max-w-2xl text-sm text-muted">
        {LAYERS} layers (shapes, shrink-to-fit text, frames; some rotated and translucent) on a 1080×1920 artboard. Drags one layer through {STEPS} pointer moves
        with snapping. &ldquo;Measure work&rdquo; times the CPU cost of each frame; &ldquo;Measure frames&rdquo; times real frame intervals (keep this window visible,
        or the browser throttles it). Budget: {BUDGET_MS} ms per frame (60 fps).
      </p>
      {result && (
        <dl id="bench-result" data-pass={result.pass} className="grid w-fit grid-cols-2 gap-x-8 gap-y-1 text-sm tabular-nums">
          <dt className="text-muted">measure</dt>
          <dd>{result.mode}</dd>
          <dt className="text-muted">p50</dt>
          <dd>{fmt(result.p50)}</dd>
          <dt className="text-muted">p95</dt>
          <dd>{fmt(result.p95)}</dd>
          <dt className="text-muted">max</dt>
          <dd>{fmt(result.max)}</dd>
          <dt className="text-muted">mean</dt>
          <dd>{fmt(result.mean)}</dd>
          {result.dropped !== null && (
            <>
              <dt className="text-muted">dropped frames</dt>
              <dd>
                {result.dropped} of {STEPS}
              </dd>
            </>
          )}
          <dt className="text-muted">verdict</dt>
          <dd className={result.pass ? "text-[var(--ok)]" : "text-danger"}>{result.pass ? "within budget" : "over budget"}</dd>
        </dl>
      )}
      <div className="relative h-[800px] w-[1200px] bg-bg2">
        <canvas ref={scene} className="absolute inset-0" />
        <canvas ref={overlay} className="absolute inset-0" />
      </div>
    </main>
  );
}
