/**
 * Splits items into columns for a masonry grid, each into the currently shortest column, so the
 * order still reads roughly left to right, top to bottom. `height` is an item's height for a column
 * width of 1 (its aspect ratio plus any caption).
 */
export function masonry<T>(items: readonly T[], columns: number, height: (item: T) => number): T[][] {
  const cols: T[][] = Array.from({ length: Math.max(1, columns) }, () => []);
  const heights = cols.map(() => 0);
  for (const item of items) {
    const i = heights.indexOf(Math.min(...heights));
    cols[i]!.push(item);
    heights[i]! += height(item);
  }
  return cols;
}
