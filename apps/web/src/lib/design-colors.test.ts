import { createEmptyDoc, type Doc, type FrameNode, type Node, type ShapeNode, type TextNode } from "@vash/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { designColors, loadRecent, normaliseColor, pushRecent, RECENT_KEY } from "./design-colors";

const globals = globalThis as { localStorage?: unknown };

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

let store: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  store = fakeStorage();
  globals.localStorage = store;
});

afterEach(() => {
  delete globals.localStorage;
});

const base = {
  name: "node",
  transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  width: 100,
  height: 100,
  opacity: 1,
  visible: true,
  lock: "free" as const,
  shadow: null,
};

const filters = { preset: null, brightness: 0, contrast: 0, saturation: 0, warmth: 0, tint: 0, highlights: 0, shadows: 0, vignette: 0, grain: 0, blur: 0, sharpen: 0 };

const text = (id: string, color: string, extra: Partial<TextNode> = {}): TextNode => ({
  ...base,
  id,
  type: "text",
  content: "Hi",
  font: { family: "Inter", weight: 400, style: "normal" },
  size: 20,
  color,
  align: "left",
  lineHeight: 1.2,
  letterSpacing: 0,
  fit: "none",
  maxChars: null,
  ...extra,
});

const shape = (id: string, extra: Partial<ShapeNode> = {}): ShapeNode => ({
  ...base,
  id,
  type: "shape",
  geometry: { kind: "ellipse" },
  fill: null,
  stroke: null,
  ...extra,
});

const frame = (id: string, extra: Partial<FrameNode["filters"]> = {}): FrameNode => ({
  ...base,
  id,
  type: "frame",
  shape: { kind: "rect", cornerRadius: 0 },
  content: null,
  filters: { ...filters, ...extra },
  placeholder: true,
});

function designWith(nodes: Node[], background?: Doc["artboard"]["background"]): Doc {
  const empty = createEmptyDoc({ id: "d", kind: "design", title: "Test", format: "ig-post" });
  return {
    ...empty,
    artboard: background ? { ...empty.artboard, background } : empty.artboard,
    root: nodes.map((n) => n.id),
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  };
}

describe("normaliseColor", () => {
  it("uppercases hex and drops an opaque alpha", () => {
    expect(normaliseColor("#1d1d1f")).toBe("#1D1D1F");
    expect(normaliseColor("#ff00ff80")).toBe("#FF00FF80");
    expect(normaliseColor("#ff00ffff")).toBe("#FF00FF");
  });

  it("rejects anything else", () => {
    expect(normaliseColor("red")).toBeNull();
    expect(normaliseColor("#FFF")).toBeNull();
    expect(normaliseColor(42)).toBeNull();
  });
});

describe("designColors", () => {
  it("collects every colour the design uses, uppercased and once each", () => {
    const doc = designWith(
      [
        text("t", "#1d1d1f", { outline: { color: "#aa0000", width: 2 }, highlight: { color: "#FFF700" } }),
        shape("s", {
          fill: { type: "linear", angle: 90, stops: [{ offset: 0, color: "#0000ff" }, { offset: 1, color: "#00ff00" }] },
          stroke: { color: "#123456", width: 4 },
          shadow: { color: "#00000040", blur: 4, offsetX: 0, offsetY: 2 },
        }),
        frame("f", { duotone: { light: "#ffeedd", dark: "#221100" } }),
      ],
      { type: "solid", color: "#ffffff" },
    );
    const colors = designColors(doc);
    expect([...colors].sort()).toEqual(
      ["#00000040", "#0000FF", "#00FF00", "#123456", "#1D1D1F", "#221100", "#AA0000", "#FFEEDD", "#FFF700", "#FFFFFF"].sort(),
    );
  });

  it("orders by how often a colour is used, with ties in first-appearance order", () => {
    const doc = designWith([
      text("a", "#AAAAAA"),
      text("b", "#BBBBBB"),
      text("c", "#BBBBBB"),
      text("d", "#CCCCCC"),
      text("e", "#AAAAAA"),
      text("f", "#DDDDDD"),
      text("g", "#DDDDDD"),
    ]);
    // The artboard's white is used once and comes first, so it sits ahead of the other single uses.
    expect(designColors(doc)).toEqual(["#AAAAAA", "#BBBBBB", "#DDDDDD", "#FFFFFF", "#CCCCCC"]);
  });

  it("caps the list at 16 by default and at `max` when given", () => {
    const nodes = Array.from({ length: 20 }, (_, i) => text(`t${i}`, `#${(i + 1).toString(16).padStart(6, "0")}`));
    const doc = designWith(nodes);
    expect(designColors(doc)).toHaveLength(16);
    expect(designColors(doc, 3)).toEqual(["#FFFFFF", "#000001", "#000002"]);
  });

  it("lists only the artboard colour for a blank design", () => {
    expect(designColors(designWith([]))).toEqual(["#FFFFFF"]);
    expect(designColors(designWith([], { type: "solid", color: "#101010" }))).toEqual(["#101010"]);
  });
});

describe("loadRecent", () => {
  it("is empty when nothing has been picked yet", () => {
    expect(loadRecent()).toEqual([]);
  });

  it("is empty when the stored value is not a list of colours", () => {
    store.data.set(RECENT_KEY, "{not json");
    expect(loadRecent()).toEqual([]);
    store.data.set(RECENT_KEY, JSON.stringify({ a: 1 }));
    expect(loadRecent()).toEqual([]);
  });

  it("drops invalid and repeated entries", () => {
    store.data.set(RECENT_KEY, JSON.stringify(["#aabbcc", "nope", 7, "#AABBCC", "#112233"]));
    expect(loadRecent()).toEqual(["#AABBCC", "#112233"]);
  });

  it("returns an empty list when there is no localStorage at all", () => {
    delete globals.localStorage;
    expect(loadRecent()).toEqual([]);
  });
});

describe("pushRecent", () => {
  it("puts the newest colour first and keeps the last 8", () => {
    let list: string[] = [];
    for (let i = 1; i <= 10; i++) list = pushRecent(`#0000${i.toString(16).padStart(2, "0")}`);
    expect(list).toHaveLength(8);
    expect(list[0]).toBe("#00000A");
    expect(list[7]).toBe("#000003");
    expect(loadRecent()).toEqual(list);
  });

  it("moves a repeated colour to the front without duplicating it", () => {
    pushRecent("#111111");
    pushRecent("#222222");
    expect(pushRecent("#111111")).toEqual(["#111111", "#222222"]);
  });

  it("normalises the colour it stores", () => {
    expect(pushRecent("#abcdef")).toEqual(["#ABCDEF"]);
    expect(JSON.parse(store.data.get(RECENT_KEY)!)).toEqual(["#ABCDEF"]);
  });

  it("ignores a colour that does not parse", () => {
    pushRecent("#333333");
    expect(pushRecent("blue")).toEqual(["#333333"]);
  });

  it("still returns the list when storage refuses the write", () => {
    globals.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(pushRecent("#444444")).toEqual(["#444444"]);
  });
});
