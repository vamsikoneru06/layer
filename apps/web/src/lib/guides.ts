/** Guide positions in design px. `x` guides are vertical lines, `y` guides are horizontal lines. */
export interface Guides {
  x: number[];
  y: number[];
}

export type GuideAxis = keyof Guides;

/** Canvas view switches. Remembered per browser, not in the document. */
export interface ViewSettings {
  rulers: boolean;
  guides: boolean;
  grid: boolean;
  snapObjects: boolean;
  snapGuides: boolean;
}

export const DEFAULT_VIEW: ViewSettings = { rulers: false, guides: true, grid: false, snapObjects: true, snapGuides: true };

const VIEW_KEY = "vash:view";
const GUIDES_PREFIX = "vash:guides:";

const round1 = (n: number) => Math.round(n * 10) / 10;
const hasIndex = (list: number[], index: number) => Number.isInteger(index) && index >= 0 && index < list.length;

export function addGuide(g: Guides, axis: GuideAxis, at: number): Guides {
  if (!Number.isFinite(at)) return g;
  return { ...g, [axis]: [...g[axis], round1(at)] };
}

export function moveGuide(g: Guides, axis: GuideAxis, index: number, at: number): Guides {
  if (!Number.isFinite(at) || !hasIndex(g[axis], index)) return g;
  return { ...g, [axis]: g[axis].map((v, i) => (i === index ? round1(at) : v)) };
}

export function removeGuide(g: Guides, axis: GuideAxis, index: number): Guides {
  if (!hasIndex(g[axis], index)) return g;
  return { ...g, [axis]: g[axis].filter((_, i) => i !== index) };
}

/** Design px to screen px: screen = design * zoom + pan, for one axis. */
export function toScreen(at: number, zoom: number, pan: number): number {
  return at * zoom + pan;
}

/** Screen px to design px, the inverse of `toScreen`. */
export function toDesign(screen: number, zoom: number, pan: number): number {
  return (screen - pan) / zoom;
}

function readJson(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full, blocked or missing. Guides then only last for this session.
  }
}

const isNumberList = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n));

export function loadGuides(designId: string): Guides {
  const v = readJson(GUIDES_PREFIX + designId);
  if (typeof v !== "object" || v === null) return { x: [], y: [] };
  const { x, y } = v as Partial<Record<GuideAxis, unknown>>;
  if (!isNumberList(x) || !isNumberList(y)) return { x: [], y: [] };
  return { x: [...x], y: [...y] };
}

export function saveGuides(designId: string, guides: Guides): void {
  writeJson(GUIDES_PREFIX + designId, { x: guides.x, y: guides.y });
}

export function loadView(): ViewSettings {
  const v = readJson(VIEW_KEY);
  const saved = typeof v === "object" && v !== null ? (v as Partial<Record<keyof ViewSettings, unknown>>) : {};
  const view = { ...DEFAULT_VIEW };
  for (const key of Object.keys(DEFAULT_VIEW) as (keyof ViewSettings)[]) {
    const value = saved[key];
    if (typeof value === "boolean") view[key] = value;
  }
  return view;
}

export function saveView(v: ViewSettings): void {
  writeJson(VIEW_KEY, {
    rulers: v.rulers,
    guides: v.guides,
    grid: v.grid,
    snapObjects: v.snapObjects,
    snapGuides: v.snapGuides,
  });
}
