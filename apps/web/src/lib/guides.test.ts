import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addGuide,
  DEFAULT_VIEW,
  loadGuides,
  loadView,
  moveGuide,
  removeGuide,
  saveGuides,
  saveView,
  toDesign,
  toScreen,
  type Guides,
} from "./guides";

interface FakeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  broken: boolean;
  items: Map<string, string>;
}

function fakeStorage(): FakeStorage {
  const items = new Map<string, string>();
  const store: FakeStorage = {
    items,
    broken: false,
    getItem(key) {
      if (store.broken) throw new Error("storage blocked");
      return items.get(key) ?? null;
    },
    setItem(key, value) {
      if (store.broken) throw new Error("storage full");
      items.set(key, value);
    },
    removeItem(key) {
      items.delete(key);
    },
  };
  return store;
}

const globals = globalThis as { localStorage?: unknown };
let store: FakeStorage;

beforeEach(() => {
  store = fakeStorage();
  globals.localStorage = store;
});

afterEach(() => {
  delete globals.localStorage;
});

const base: Guides = { x: [10], y: [20, 30] };

describe("guide helpers", () => {
  it("adds a guide on the given axis, rounded to one decimal, without touching the input", () => {
    const next = addGuide(base, "y", 40.256);
    expect(next).toEqual({ x: [10], y: [20, 30, 40.3] });
    expect(base).toEqual({ x: [10], y: [20, 30] });
  });

  it("ignores non-finite positions", () => {
    expect(addGuide(base, "x", Number.NaN)).toBe(base);
    expect(addGuide(base, "x", Number.POSITIVE_INFINITY)).toBe(base);
    expect(moveGuide(base, "x", 0, Number.NaN)).toBe(base);
  });

  it("moves one guide and keeps the others", () => {
    const next = moveGuide(base, "y", 1, 99.04);
    expect(next).toEqual({ x: [10], y: [20, 99] });
    expect(base.y).toEqual([20, 30]);
  });

  it("returns the same guides for an index that does not exist", () => {
    expect(moveGuide(base, "x", 5, 1)).toBe(base);
    expect(moveGuide(base, "x", -1, 1)).toBe(base);
    expect(moveGuide(base, "x", 0.5, 1)).toBe(base);
    expect(removeGuide(base, "y", 2)).toBe(base);
  });

  it("removes one guide without touching the input", () => {
    const next = removeGuide(base, "y", 0);
    expect(next).toEqual({ x: [10], y: [30] });
    expect(base.y).toEqual([20, 30]);
  });

  it("maps between design and screen px with screen = design * zoom + pan", () => {
    expect(toScreen(100, 2, 30)).toBe(230);
    expect(toDesign(230, 2, 30)).toBe(100);
    expect(toDesign(toScreen(37.5, 0.5, -12), 0.5, -12)).toBeCloseTo(37.5);
  });
});

describe("guide storage", () => {
  it("returns empty guides when nothing is saved", () => {
    expect(loadGuides("d1")).toEqual({ x: [], y: [] });
  });

  it("round-trips guides per design", () => {
    saveGuides("d1", { x: [1, 2], y: [3] });
    saveGuides("d2", { x: [], y: [9] });
    expect(store.items.get("vash:guides:d1")).toBe(JSON.stringify({ x: [1, 2], y: [3] }));
    expect(loadGuides("d1")).toEqual({ x: [1, 2], y: [3] });
    expect(loadGuides("d2")).toEqual({ x: [], y: [9] });
  });

  it("falls back to empty guides for bad JSON or the wrong shape", () => {
    store.items.set("vash:guides:bad", "{not json");
    store.items.set("vash:guides:list", JSON.stringify([1, 2]));
    store.items.set("vash:guides:strings", JSON.stringify({ x: ["a"], y: [] }));
    store.items.set("vash:guides:missing", JSON.stringify({ x: [1] }));
    store.items.set("vash:guides:nan", JSON.stringify({ x: [1], y: [null] }));
    for (const id of ["bad", "list", "strings", "missing", "nan"]) {
      expect(loadGuides(id)).toEqual({ x: [], y: [] });
    }
  });

  it("does not throw when storage throws, and falls back to empty guides", () => {
    saveGuides("d1", { x: [1], y: [] });
    store.broken = true;
    expect(() => saveGuides("d1", { x: [2], y: [] })).not.toThrow();
    expect(loadGuides("d1")).toEqual({ x: [], y: [] });
  });

  it("works without any localStorage at all", () => {
    delete globals.localStorage;
    expect(() => saveGuides("d1", { x: [1], y: [] })).not.toThrow();
    expect(loadGuides("d1")).toEqual({ x: [], y: [] });
  });
});

describe("view storage", () => {
  it("returns the defaults when nothing is saved", () => {
    expect(loadView()).toEqual(DEFAULT_VIEW);
  });

  it("round-trips the view settings under vash:view", () => {
    const view = { ...DEFAULT_VIEW, rulers: true, grid: true, snapGuides: false };
    saveView(view);
    expect(store.items.has("vash:view")).toBe(true);
    expect(loadView()).toEqual(view);
  });

  it("keeps valid booleans and defaults the rest", () => {
    store.items.set("vash:view", JSON.stringify({ rulers: true, grid: "yes", snapObjects: 0, extra: true }));
    expect(loadView()).toEqual({ ...DEFAULT_VIEW, rulers: true });
  });

  it("falls back to the defaults for bad JSON or a non-object", () => {
    store.items.set("vash:view", "{oops");
    expect(loadView()).toEqual(DEFAULT_VIEW);
    store.items.set("vash:view", JSON.stringify(42));
    expect(loadView()).toEqual(DEFAULT_VIEW);
    store.items.set("vash:view", JSON.stringify(null));
    expect(loadView()).toEqual(DEFAULT_VIEW);
  });

  it("does not throw when storage throws", () => {
    store.broken = true;
    expect(() => saveView({ ...DEFAULT_VIEW, grid: true })).not.toThrow();
    expect(loadView()).toEqual(DEFAULT_VIEW);
  });
});
