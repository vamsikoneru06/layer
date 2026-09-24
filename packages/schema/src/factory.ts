import { CURRENT_SCHEMA_VERSION, FORMATS } from "./constants";
import type { Doc, Filters, FormatKey } from "./types";

export function defaultFilters(): Filters {
  return {
    preset: null,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    warmth: 0,
    tint: 0,
    highlights: 0,
    shadows: 0,
    vignette: 0,
    grain: 0,
    blur: 0,
    sharpen: 0,
  };
}

export interface EmptyDocOptions {
  id: string;
  kind: Doc["kind"];
  title: string;
  format: FormatKey;
  /** Required when format is "custom". */
  size?: { width: number; height: number };
}

export function createEmptyDoc(options: EmptyDocOptions): Doc {
  const size = options.format === "custom" ? options.size : FORMATS[options.format];
  if (!size) throw new Error("custom format requires a size");
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: options.id,
    kind: options.kind,
    meta: { title: options.title, category: null, tags: [], format: options.format },
    artboard: { width: size.width, height: size.height, background: { type: "solid", color: "#FFFFFF" } },
    root: [],
    nodes: {},
    assets: {},
  };
}
