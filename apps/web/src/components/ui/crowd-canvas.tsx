"use client";

import { gsap } from "gsap";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A crowd of Open Peeps walking across the bottom of the page.
 * Adapted from Skiper UI "Skiper 39" (https://gxuri.me), itself after https://codepen.io/zadvorsky/pen/xxwbBQV;
 * illustrations by https://www.openpeeps.com/ (CC0).
 */

type Peep = {
  rect: [number, number, number, number];
  width: number;
  height: number;
  x: number;
  y: number;
  anchorY: number;
  scaleX: 1 | -1;
  walk: gsap.core.Timeline | null;
};

const randomRange = (min: number, max: number) => min + Math.random() * (max - min);
const takeAt = <T,>(array: T[], i: number): T => array.splice(i, 1)[0]!;

export function CrowdCanvas({ src, rows, cols, className }: { src: string; rows: number; cols: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stage = { width: 0, height: 0 };
    const all: Peep[] = [];
    const available: Peep[] = [];
    const crowd: Peep[] = [];
    const img = new Image();
    let disposed = false;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      for (const p of crowd) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(p.scaleX, 1);
        ctx.drawImage(img, ...p.rect, 0, 0, p.width, p.height);
        ctx.restore();
      }
      ctx.restore();
    };

    const walk = (p: Peep) => {
      const direction = Math.random() > 0.5 ? 1 : -1;
      const startY = stage.height - p.height + 100 - 250 * gsap.parseEase("power2.in")(Math.random());
      const endX = direction === 1 ? stage.width : 0;
      p.x = direction === 1 ? -p.width : stage.width + p.width;
      p.scaleX = direction;
      p.y = p.anchorY = startY;

      const tl = gsap.timeline();
      tl.timeScale(randomRange(0.5, 1.5));
      tl.to(p, { duration: 10, x: endX, ease: "none" }, 0);
      tl.to(p, { duration: 0.25, repeat: 40, yoyo: true, y: startY - 10 }, 0);
      return tl;
    };

    const addPeep = () => {
      const p = takeAt(available, Math.floor(Math.random() * available.length));
      p.walk = walk(p).eventCallback("onComplete", () => {
        takeAt(crowd, crowd.indexOf(p));
        available.push(p);
        addPeep();
      });
      crowd.push(p);
      crowd.sort((a, b) => a.anchorY - b.anchorY);
      return p;
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      stage.width = canvas.clientWidth;
      stage.height = canvas.clientHeight;
      canvas.width = stage.width * dpr;
      canvas.height = stage.height * dpr;
      // Sprite cells are ~240 px wide; at full size on a phone they would bury the hero's buttons.
      const scale = Math.min(1, Math.max(0.45, stage.width / 1200));
      for (const p of all) {
        p.width = p.rect[2] * scale;
        p.height = p.rect[3] * scale;
      }
      for (const p of crowd) p.walk?.kill();
      crowd.length = 0;
      available.length = 0;
      available.push(...all);
      while (available.length) {
        const walker = addPeep().walk!;
        walker.progress(Math.random());
        if (still) walker.pause();
      }
      if (still) render();
    };

    img.onload = () => {
      if (disposed) return;
      const w = img.naturalWidth / rows;
      const h = img.naturalHeight / cols;
      for (let i = 0; i < rows * cols; i++) {
        all.push({ rect: [(i % rows) * w, Math.floor(i / rows) * h, w, h], width: w, height: h, x: 0, y: 0, anchorY: 0, scaleX: 1, walk: null });
      }
      resize();
      if (!still) gsap.ticker.add(render);
    };
    img.src = src;

    window.addEventListener("resize", resize);
    return () => {
      disposed = true;
      window.removeEventListener("resize", resize);
      gsap.ticker.remove(render);
      for (const p of crowd) p.walk?.kill();
    };
  }, [src, rows, cols]);

  return <canvas ref={canvasRef} aria-hidden className={cn("absolute bottom-0 left-0 w-full", className)} />;
}
