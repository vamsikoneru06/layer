interface Size {
  width: number;
  height: number;
}

/** Where to draw a menu opened at `at` so it stays inside the window, with a margin on every side. */
export function clampMenuPosition(at: { x: number; y: number }, size: Size, view: Size, margin = 8): { x: number; y: number } {
  return {
    x: Math.max(margin, Math.min(at.x, view.width - size.width - margin)),
    y: Math.max(margin, Math.min(at.y, view.height - size.height - margin)),
  };
}
