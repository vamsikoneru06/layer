import { CATEGORIES, CURRENT_SCHEMA_VERSION, FONT_FAMILIES, FORMAT_KEYS, LIMITS, RESERVED_KEYS } from "./constants";
import { validatePathData } from "./path";
import type { Doc, ValidationIssue, ValidationResult } from "./types";

/**
 * Hand-written, strict validator for the document format.
 * - Unknown keys are rejected everywhere (nothing can be smuggled through the format).
 * - Every issue carries a dotted path so the UI and API can point at the exact value.
 * - Structural rules (every node reachable exactly once, no cycles, all references resolve)
 *   are checked after the shape checks pass.
 */

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const PRESET = /^[a-z0-9-]{1,32}$/;

type Obj = Record<string, unknown>;

class Checker {
  readonly issues: ValidationIssue[] = [];

  fail(path: string, message: string): false {
    this.issues.push({ path, message });
    return false;
  }

  object(value: unknown, path: string, keys: readonly string[]): value is Obj {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return this.fail(path, "expected object");
    }
    let ok = true;
    for (const key of keys) {
      if (!Object.hasOwn(value, key)) ok = this.fail(join(path, key), "is required");
    }
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) ok = this.fail(join(path, key), "is not allowed");
    }
    return ok;
  }

  number(value: unknown, path: string, min: number, max: number): boolean {
    if (typeof value !== "number" || !Number.isFinite(value)) return this.fail(path, "expected finite number");
    if (value < min || value > max) return this.fail(path, `must be between ${min} and ${max}`);
    return true;
  }

  integer(value: unknown, path: string, min: number, max: number): boolean {
    if (!this.number(value, path, min, max)) return false;
    return Number.isInteger(value) || this.fail(path, "expected integer");
  }

  string(value: unknown, path: string, min: number, max: number): value is string {
    if (typeof value !== "string") return this.fail(path, "expected string");
    if (value.length < min || value.length > max) return this.fail(path, `length must be between ${min} and ${max}`);
    return true;
  }

  boolean(value: unknown, path: string): boolean {
    return typeof value === "boolean" || this.fail(path, "expected boolean");
  }

  oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): value is T {
    return (typeof value === "string" && (options as readonly string[]).includes(value)) ||
      this.fail(path, `must be one of: ${options.join(", ")}`);
  }

  color(value: unknown, path: string): boolean {
    return (typeof value === "string" && COLOR.test(value)) || this.fail(path, "expected #RRGGBB or #RRGGBBAA");
  }

  id(value: unknown, path: string): value is string {
    if (typeof value !== "string" || !ID.test(value)) return this.fail(path, "expected id [A-Za-z0-9_-]{1,64}");
    if (RESERVED_KEYS.has(value)) return this.fail(path, "reserved id");
    return true;
  }

  array(value: unknown, path: string, min: number, max: number): value is unknown[] {
    if (!Array.isArray(value)) return this.fail(path, "expected array");
    if (value.length < min || value.length > max) return this.fail(path, `must have between ${min} and ${max} items`);
    return true;
  }

  nullable<T>(value: unknown, path: string, check: (v: unknown, p: string) => T): boolean {
    return value === null || Boolean(check(value, path));
  }
}

function join(path: string, key: string | number): string {
  return path === "" ? String(key) : `${path}.${key}`;
}

const BASE_NODE_KEYS = ["id", "type", "name", "transform", "width", "height", "opacity", "visible", "lock"] as const;
const NODE_KEYS: Record<string, readonly string[]> = {
  frame: [...BASE_NODE_KEYS, "shape", "content", "filters", "placeholder"],
  text: [...BASE_NODE_KEYS, "content", "font", "size", "color", "align", "lineHeight", "letterSpacing", "fit", "maxChars"],
  shape: [...BASE_NODE_KEYS, "geometry", "fill", "stroke"],
  sticker: [...BASE_NODE_KEYS, "assetId"],
  group: [...BASE_NODE_KEYS, "children"],
};
const FILTER_SIGNED = ["brightness", "contrast", "saturation", "warmth", "tint", "highlights", "shadows"] as const;
const FILTER_UNSIGNED = ["vignette", "grain", "blur", "sharpen"] as const;

function checkFill(c: Checker, v: unknown, path: string): boolean {
  if (typeof v !== "object" || v === null) return c.fail(path, "expected fill object");
  const type = (v as Obj).type;
  if (type === "solid") {
    if (!c.object(v, path, ["type", "color"])) return false;
    return c.color(v.color, join(path, "color"));
  }
  if (type === "linear") {
    if (!c.object(v, path, ["type", "angle", "stops"])) return false;
    c.number(v.angle, join(path, "angle"), -360, 360);
    if (c.array(v.stops, join(path, "stops"), 2, LIMITS.gradientStops)) {
      v.stops.forEach((stop, i) => {
        const sp = join(join(path, "stops"), i);
        if (c.object(stop, sp, ["offset", "color"])) {
          c.number(stop.offset, join(sp, "offset"), 0, 1);
          c.color(stop.color, join(sp, "color"));
        }
      });
    }
    return true;
  }
  return c.fail(join(path, "type"), "must be one of: solid, linear");
}

function checkPath(c: Checker, d: unknown, path: string): void {
  if (!c.string(d, path, 1, LIMITS.pathChars)) return;
  const result = validatePathData(d, LIMITS.pathChars);
  if (!result.ok) c.fail(path, result.error);
}

function checkTransform(c: Checker, v: unknown, path: string): void {
  if (!c.object(v, path, ["x", "y", "rotation", "scaleX", "scaleY"])) return;
  c.number(v.x, join(path, "x"), -LIMITS.coordinate, LIMITS.coordinate);
  c.number(v.y, join(path, "y"), -LIMITS.coordinate, LIMITS.coordinate);
  c.number(v.rotation, join(path, "rotation"), -LIMITS.rotation, LIMITS.rotation);
  for (const axis of ["scaleX", "scaleY"] as const) {
    const s = v[axis];
    if (c.number(s, join(path, axis), -LIMITS.scaleMax, LIMITS.scaleMax) && Math.abs(s as number) < LIMITS.scaleMin) {
      c.fail(join(path, axis), `magnitude must be at least ${LIMITS.scaleMin}`);
    }
  }
}

function checkFilters(c: Checker, v: unknown, path: string): void {
  if (!c.object(v, path, ["preset", ...FILTER_SIGNED, ...FILTER_UNSIGNED])) return;
  if (v.preset !== null && (typeof v.preset !== "string" || !PRESET.test(v.preset))) {
    c.fail(join(path, "preset"), "expected null or preset key [a-z0-9-]{1,32}");
  }
  for (const k of FILTER_SIGNED) c.number(v[k], join(path, k), -1, 1);
  for (const k of FILTER_UNSIGNED) c.number(v[k], join(path, k), 0, 1);
}

function checkNode(c: Checker, key: string, v: unknown, path: string): void {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    c.fail(path, "expected node object");
    return;
  }
  const type = (v as Obj).type;
  const keys = typeof type === "string" ? NODE_KEYS[type] : undefined;
  if (!keys) {
    c.fail(join(path, "type"), "must be one of: frame, text, shape, sticker, group");
    return;
  }
  if (!c.object(v, path, keys)) return;
  if (c.id(v.id, join(path, "id")) && v.id !== key) c.fail(join(path, "id"), "must match its key in nodes");
  c.string(v.name, join(path, "name"), 0, LIMITS.nameChars);
  checkTransform(c, v.transform, join(path, "transform"));
  c.number(v.width, join(path, "width"), 0.001, LIMITS.coordinate);
  c.number(v.height, join(path, "height"), 0.001, LIMITS.coordinate);
  c.number(v.opacity, join(path, "opacity"), 0, 1);
  c.boolean(v.visible, join(path, "visible"));
  c.oneOf(v.lock, join(path, "lock"), ["free", "content-only", "locked"] as const);

  switch (type) {
    case "frame": {
      const sp = join(path, "shape");
      const shape = v.shape as Obj | null;
      const kind = shape && typeof shape === "object" ? shape.kind : undefined;
      if (kind === "rect") {
        if (c.object(shape, sp, ["kind", "cornerRadius"])) c.number(shape.cornerRadius, join(sp, "cornerRadius"), 0, LIMITS.coordinate);
      } else if (kind === "ellipse") {
        c.object(shape, sp, ["kind"]);
      } else if (kind === "path") {
        if (c.object(shape, sp, ["kind", "d"])) checkPath(c, shape.d, join(sp, "d"));
      } else {
        c.fail(join(sp, "kind"), "must be one of: rect, ellipse, path");
      }
      if (v.content !== null) {
        const cp = join(path, "content");
        if (c.object(v.content, cp, ["assetId", "offsetX", "offsetY", "scale"])) {
          c.id(v.content.assetId, join(cp, "assetId"));
          c.number(v.content.offsetX, join(cp, "offsetX"), -LIMITS.coordinate, LIMITS.coordinate);
          c.number(v.content.offsetY, join(cp, "offsetY"), -LIMITS.coordinate, LIMITS.coordinate);
          c.number(v.content.scale, join(cp, "scale"), 1, LIMITS.scaleMax);
        }
      }
      checkFilters(c, v.filters, join(path, "filters"));
      c.boolean(v.placeholder, join(path, "placeholder"));
      break;
    }
    case "text": {
      c.string(v.content, join(path, "content"), 0, LIMITS.textChars);
      const fp = join(path, "font");
      if (c.object(v.font, fp, ["family", "weight", "style"])) {
        c.oneOf(v.font.family, join(fp, "family"), FONT_FAMILIES);
        if (c.integer(v.font.weight, join(fp, "weight"), 100, 900) && (v.font.weight as number) % 100 !== 0) {
          c.fail(join(fp, "weight"), "must be a multiple of 100");
        }
        c.oneOf(v.font.style, join(fp, "style"), ["normal", "italic"] as const);
      }
      c.number(v.size, join(path, "size"), LIMITS.fontSizeMin, LIMITS.fontSizeMax);
      c.color(v.color, join(path, "color"));
      c.oneOf(v.align, join(path, "align"), ["left", "center", "right", "justify"] as const);
      c.number(v.lineHeight, join(path, "lineHeight"), 0.5, 5);
      c.number(v.letterSpacing, join(path, "letterSpacing"), -100, 500);
      c.oneOf(v.fit, join(path, "fit"), ["none", "shrink"] as const);
      c.nullable(v.maxChars, join(path, "maxChars"), (m, p) => c.integer(m, p, 1, LIMITS.textChars));
      break;
    }
    case "shape": {
      const gp = join(path, "geometry");
      const geometry = v.geometry as Obj | null;
      const kind = geometry && typeof geometry === "object" ? geometry.kind : undefined;
      if (kind === "rect") {
        if (c.object(geometry, gp, ["kind", "cornerRadius"])) c.number(geometry.cornerRadius, join(gp, "cornerRadius"), 0, LIMITS.coordinate);
      } else if (kind === "ellipse") {
        c.object(geometry, gp, ["kind"]);
      } else if (kind === "polygon") {
        if (c.object(geometry, gp, ["kind", "sides"])) c.integer(geometry.sides, join(gp, "sides"), LIMITS.polygonSidesMin, LIMITS.polygonSidesMax);
      } else if (kind === "path") {
        if (c.object(geometry, gp, ["kind", "d"])) checkPath(c, geometry.d, join(gp, "d"));
      } else {
        c.fail(join(gp, "kind"), "must be one of: rect, ellipse, polygon, path");
      }
      c.nullable(v.fill, join(path, "fill"), (f, p) => checkFill(c, f, p));
      if (v.stroke !== null) {
        const sp = join(path, "stroke");
        if (c.object(v.stroke, sp, ["color", "width"])) {
          c.color(v.stroke.color, join(sp, "color"));
          c.number(v.stroke.width, join(sp, "width"), 0, LIMITS.strokeWidthMax);
        }
      }
      break;
    }
    case "sticker":
      c.id(v.assetId, join(path, "assetId"));
      break;
    case "group":
      if (c.array(v.children, join(path, "children"), 1, LIMITS.designNodes)) {
        v.children.forEach((child, i) => c.id(child, join(join(path, "children"), i)));
      }
      break;
  }
}

function checkAsset(c: Checker, key: string, v: unknown, path: string): void {
  if (!c.object(v, path, ["id", "kind", "mime", "width", "height"])) return;
  if (c.id(v.id, join(path, "id")) && v.id !== key) c.fail(join(path, "id"), "must match its key in assets");
  const kind = c.oneOf(v.kind, join(path, "kind"), ["photo", "sticker"] as const) ? v.kind : null;
  const mimes = kind === "sticker"
    ? (["image/png", "image/webp", "image/svg+xml"] as const)
    : (["image/jpeg", "image/png", "image/webp"] as const);
  c.oneOf(v.mime, join(path, "mime"), mimes);
  c.integer(v.width, join(path, "width"), 1, 20_000);
  c.integer(v.height, join(path, "height"), 1, 20_000);
}

/** Structural rules: references resolve, every node is reachable exactly once, no cycles, types match. */
function checkStructure(c: Checker, doc: Doc): void {
  const parentOf = new Map<string, string>();
  const claim = (id: string, owner: string, path: string) => {
    if (!Object.hasOwn(doc.nodes, id)) {
      c.fail(path, `references missing node '${id}'`);
      return;
    }
    const existing = parentOf.get(id);
    if (existing !== undefined) {
      c.fail(path, `node '${id}' is already placed under '${existing}'`);
      return;
    }
    parentOf.set(id, owner);
  };

  doc.root.forEach((id, i) => claim(id, "root", `root.${i}`));
  for (const node of Object.values(doc.nodes)) {
    if (node.type === "group") {
      node.children.forEach((id, i) => {
        if (id === node.id) c.fail(`nodes.${node.id}.children.${i}`, "group cannot contain itself");
        else claim(id, node.id, `nodes.${node.id}.children.${i}`);
      });
    }
  }
  for (const id of Object.keys(doc.nodes)) {
    if (!parentOf.has(id)) c.fail(`nodes.${id}`, "is not reachable from root");
  }

  // Cycle check: walking up from any node must reach root.
  for (const id of Object.keys(doc.nodes)) {
    const seen = new Set<string>();
    let cursor: string | undefined = id;
    while (cursor !== undefined && cursor !== "root") {
      if (seen.has(cursor)) {
        c.fail(`nodes.${id}`, "is part of a group cycle");
        break;
      }
      seen.add(cursor);
      cursor = parentOf.get(cursor);
    }
  }

  const assetKind = (assetId: string, expected: "photo" | "sticker", path: string) => {
    const asset = Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId] : undefined;
    if (!asset) c.fail(path, `references missing asset '${assetId}'`);
    else if (asset.kind !== expected) c.fail(path, `asset '${assetId}' must be a ${expected}`);
  };
  for (const node of Object.values(doc.nodes)) {
    if (node.type === "frame" && node.content) assetKind(node.content.assetId, "photo", `nodes.${node.id}.content.assetId`);
    if (node.type === "sticker") assetKind(node.assetId, "sticker", `nodes.${node.id}.assetId`);
  }
}

export interface ValidateOptions {
  /** Reject documents whose kind differs. */
  kind?: Doc["kind"];
}

export function validateDoc(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const c = new Checker();

  let bytes: number;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(input)).length;
  } catch {
    return { ok: false, issues: [{ path: "", message: "document is not serializable" }] };
  }
  if (bytes > LIMITS.docBytes) {
    return { ok: false, issues: [{ path: "", message: `document exceeds ${LIMITS.docBytes} bytes` }] };
  }

  const topKeys = ["schemaVersion", "id", "kind", "meta", "artboard", "root", "nodes", "assets"] as const;
  if (!c.object(input, "", topKeys)) return { ok: false, issues: c.issues };

  if (input.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    c.fail("schemaVersion", `must be ${CURRENT_SCHEMA_VERSION} (run migrateDoc first)`);
  }
  c.id(input.id, "id");
  if (c.oneOf(input.kind, "kind", ["design", "template"] as const) && options.kind && input.kind !== options.kind) {
    c.fail("kind", `must be '${options.kind}'`);
  }

  if (c.object(input.meta, "meta", ["title", "category", "tags", "format"])) {
    const meta = input.meta;
    c.string(meta.title, "meta.title", 1, LIMITS.titleChars);
    c.nullable(meta.category, "meta.category", (v, p) => c.oneOf(v, p, CATEGORIES));
    if (c.array(meta.tags, "meta.tags", 0, LIMITS.tags)) {
      meta.tags.forEach((tag, i) => c.string(tag, `meta.tags.${i}`, 1, LIMITS.tagChars));
    }
    c.oneOf(meta.format, "meta.format", FORMAT_KEYS);
  }

  if (c.object(input.artboard, "artboard", ["width", "height", "background"])) {
    c.integer(input.artboard.width, "artboard.width", LIMITS.artboardMin, LIMITS.artboardMax);
    c.integer(input.artboard.height, "artboard.height", LIMITS.artboardMin, LIMITS.artboardMax);
    checkFill(c, input.artboard.background, "artboard.background");
  }

  const maxNodes = input.kind === "template" ? LIMITS.templateNodes : LIMITS.designNodes;
  if (c.array(input.root, "root", 0, maxNodes)) {
    input.root.forEach((id, i) => c.id(id, `root.${i}`));
  }

  if (c.object(input.nodes, "nodes", Object.keys(input.nodes ?? {}))) {
    const entries = Object.entries(input.nodes);
    if (entries.length > maxNodes) c.fail("nodes", `must have at most ${maxNodes} nodes`);
    for (const [key, node] of entries) {
      if (c.id(key, `nodes.${key}`)) checkNode(c, key, node, `nodes.${key}`);
    }
  }

  if (c.object(input.assets, "assets", Object.keys(input.assets ?? {}))) {
    const entries = Object.entries(input.assets);
    if (entries.length > LIMITS.assets) c.fail("assets", `must have at most ${LIMITS.assets} assets`);
    for (const [key, asset] of entries) {
      if (c.id(key, `assets.${key}`)) checkAsset(c, key, asset, `assets.${key}`);
    }
  }

  if (c.issues.length > 0) return { ok: false, issues: c.issues };

  const doc = input as unknown as Doc;
  checkStructure(c, doc);
  return c.issues.length > 0 ? { ok: false, issues: c.issues } : { ok: true, doc };
}
