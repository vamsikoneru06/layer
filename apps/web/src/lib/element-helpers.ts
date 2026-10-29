/**
 * Pure helpers for the Shapes panel: where a regular polygon's corners sit, how a preview box keeps a shape's
 * proportions, and the name search over the catalogues.
 */

/**
 * Corners of a regular polygon in the unit box (0 to 1), in the order the engine draws them: the first at the
 * top centre, then clockwise on screen.
 */
export function polygonUnitPoints(sides: number): [number, number][] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    return [0.5 + 0.5 * Math.cos(angle), 0.5 + 0.5 * Math.sin(angle)];
  });
}

/** `width` by `height` scaled uniformly so that its longer side is `size`. */
export function fitBox(width: number, height: number, size: number): { width: number; height: number } {
  const scale = size / Math.max(width, height);
  return { width: width * scale, height: height * scale };
}

/** The items whose name contains `query`, ignoring case and surrounding spaces. A blank query keeps everything. */
export function filterByName<T extends { name: string }>(items: readonly T[], query: string): readonly T[] {
  const q = query.trim().toLowerCase();
  return q ? items.filter((item) => item.name.toLowerCase().includes(q)) : items;
}
