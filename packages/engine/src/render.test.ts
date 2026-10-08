import { describe, expect, it } from "vitest";
import { recordingContext } from "./recording-ctx";
import { renderDoc, renderScene, type ImageState } from "./render";
import { docWith, frame, group, rect, text } from "./test-docs";

const measure = (s: string, _f: unknown, size: number) => s.length * size * 0.5;
const noImages = (): ImageState => "loading";
const view = { zoom: 0.5, panX: 10, panY: 20 };

describe("renderScene", () => {
  it("clears, then paints the artboard through the viewport at device pixels", () => {
    const { ctx, calls } = recordingContext();
    renderScene(ctx, docWith([]), view, { measure, image: noImages, dpr: 2 });
    expect(calls[0]).toEqual({ op: "setTransform", args: [1, 0, 0, 1, 0, 0] });
    expect(calls[1]).toEqual({ op: "clearRect", args: [0, 0, 800, 600] });
    expect(calls).toContainEqual({ op: "setTransform", args: [1, 0, 0, 1, 20, 40] });
    expect(calls).toContainEqual({ op: "fillRect", args: [-500, -500, 1000, 1000] });
  });

  it("paints layers bottom to top, each with its world transform and combined opacity", () => {
    const doc = docWith([rect("a", { x: 100, y: 100 }), { ...group("g", { x: 500, y: 500 }, ["b"]), opacity: 0.5 }], [{ ...rect("b", { x: 10, y: 0 }), opacity: 0.5 }]);
    const { ctx, calls } = recordingContext();
    renderScene(ctx, doc, { zoom: 1, panX: 0, panY: 0 }, { measure, image: noImages, dpr: 1 });
    const transforms = calls.filter((c) => c.op === "setTransform").map((c) => c.args);
    expect(transforms).toContainEqual([1, 0, 0, 1, 100, 100]);
    expect(transforms).toContainEqual([1, 0, 0, 1, 510, 500]);
    const alphas = calls.filter((c) => c.op === "set:globalAlpha").map((c) => c.args[0]);
    expect(alphas.slice(0, 2)).toEqual([1, 0.25]);
  });

  it("shows empty frames as a labelled placeholder, clipped to the frame", () => {
    const { ctx, calls } = recordingContext();
    renderScene(ctx, docWith([frame("f", { x: 300, y: 300 }, 400, 300)]), view, { measure, image: noImages, dpr: 1 });
    const clip = calls.findIndex((c) => c.op === "clip");
    const label = calls.findIndex((c) => c.op === "fillText" && c.args[0] === "Drop a photo");
    expect(clip).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(clip);
  });

  it("draws photos cover-fitted inside frames, and marks missing ones", () => {
    const f = { ...frame("f", {}, 200, 100), content: { assetId: "p1", offsetX: 0, offsetY: 0, scale: 1 } };
    const source = { tag: "img" } as unknown as CanvasImageSource;
    const { ctx, calls } = recordingContext();
    renderScene(ctx, docWith([f]), view, { measure, image: () => ({ source, width: 100, height: 100 }), dpr: 1 });
    // 100×100 photo covering a 200×100 frame is drawn 200×200, centred.
    expect(calls).toContainEqual({ op: "drawImage", args: [source, -100, -100, 200, 200] });

    const missing = recordingContext();
    renderScene(missing.ctx, docWith([f]), view, { measure, image: () => "missing", dpr: 1 });
    expect(missing.calls.some((c) => c.op === "fillText" && c.args[0] === "Photo unavailable")).toBe(true);
  });

  it("draws each wrapped text line with the layer's font and colour", () => {
    const t = { ...text("t", {}, "aaa bbb", 100, 100), size: 20, color: "#123456" };
    const { ctx, calls } = recordingContext();
    renderScene(ctx, docWith([t]), view, { measure, image: noImages, dpr: 1 });
    expect(calls.filter((c) => c.op === "fillText").map((c) => c.args[0])).toEqual(["aaa bbb"]);
    expect(calls).toContainEqual({ op: "set:font", args: ['normal 400 20px "Inter", system-ui, sans-serif'] });
    expect(calls).toContainEqual({ op: "set:fillStyle", args: ["#123456"] });
  });

  it("places justified words using one letter-spacing step per visible character, as layout does", () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const perGlyph = (s: string, _f: unknown, size: number) => [...segmenter.segment(s)].length * size * 0.5;
    // 10 px per character plus 2 px spacing: "😀😀 aa bb" is 8 characters, 96 px, so 4 px spread over 2 gaps.
    const t = { ...text("t", {}, "😀😀 aa bb cc", 100, 100), size: 20, letterSpacing: 2, align: "justify" as const };
    const { ctx, calls } = recordingContext();
    renderScene(ctx, docWith([t]), view, { measure: perGlyph, image: noImages, dpr: 1 });
    const words = calls.filter((c) => c.op === "fillText").map((c) => [c.args[0], c.args[1]]);
    expect(words.slice(0, 3)).toEqual([
      ["😀😀", -50],
      ["aa", -12],
      ["bb", 26],
    ]);
  });
});

describe("renderDoc shadows and stroke dashes", () => {
  const opts = { measure, image: noImages, dpr: 1 };
  const identity = [1, 0, 0, 1, 0, 0] as const;
  const shadow = { color: "#00000080", blur: 10, offsetX: 4, offsetY: -8 };
  const shadowOps = (calls: Array<{ op: string; args: unknown[] }>) => calls.filter((c) => c.op.startsWith("set:shadow")).map((c) => [c.op, c.args[0]]);

  it("sets the shadow before a node is painted, and resets it after", () => {
    const { ctx, calls } = recordingContext();
    renderDoc(ctx, docWith([{ ...rect("a", {}), shadow }]), identity, opts, { background: false });
    expect(shadowOps(calls)).toEqual([
      ["set:shadowColor", shadow.color],
      ["set:shadowBlur", 10],
      ["set:shadowOffsetX", 4],
      ["set:shadowOffsetY", -8],
      ["set:shadowColor", "transparent"],
      ["set:shadowBlur", 0],
      ["set:shadowOffsetX", 0],
      ["set:shadowOffsetY", 0],
    ]);
    const paint = calls.findIndex((c) => c.op === "fill");
    expect(calls.findIndex((c) => c.op === "set:shadowColor" && c.args[0] === shadow.color)).toBeLessThan(paint);
    expect(calls.findIndex((c, i) => i > paint && c.op === "set:shadowColor" && c.args[0] === "transparent")).toBeGreaterThan(paint);
  });

  it("scales the shadow's blur and offsets by the device scale, so it holds at every zoom", () => {
    const { ctx, calls } = recordingContext();
    renderDoc(ctx, docWith([{ ...rect("a", {}), shadow }]), [2, 0, 0, 2, 0, 0], opts, { background: false });
    expect(calls).toContainEqual({ op: "set:shadowBlur", args: [20] });
    expect(calls).toContainEqual({ op: "set:shadowOffsetX", args: [8] });
    expect(calls).toContainEqual({ op: "set:shadowOffsetY", args: [-16] });
  });

  it("casts a frame's shadow from its outline drawn off the canvas, so the photo clip cannot hide it", () => {
    const { ctx, calls } = recordingContext();
    renderDoc(ctx, docWith([{ ...frame("f", {}, 200, 100), shadow }]), [2, 0, 0, 2, 0, 0], opts, { background: false });
    const far = 100_000 / 2;
    // The outline moves `far` frame units right (2 * far device px), and the shadow offset points back.
    expect(calls).toContainEqual({ op: "translate", args: [far, 0] });
    expect(calls).toContainEqual({ op: "set:shadowOffsetX", args: [4 * 2 - 2 * far] });
    expect(calls).toContainEqual({ op: "set:shadowOffsetY", args: [-8 * 2] });
    expect(calls).toContainEqual({ op: "set:shadowBlur", args: [20] });
    const castAt = calls.findIndex((c) => c.op === "fill");
    expect(castAt).toBeGreaterThan(-1);
    // The frame's own photo clip comes after the cast.
    expect(calls.findIndex((c, i) => i > castAt && c.op === "clip")).toBeGreaterThan(castAt);
  });

  it("sets no shadow when a node has none or null", () => {
    const { ctx, calls } = recordingContext();
    renderDoc(ctx, docWith([rect("a", {}), { ...rect("b", { x: 200 }), shadow: null }]), identity, opts, { background: false });
    expect(shadowOps(calls)).toEqual([]);
  });

  it("gives a group's shadow to each child without a shadow of its own", () => {
    const groupShadow = { ...shadow, color: "#FF000080" };
    const childShadow = { ...shadow, color: "#0000FF80" };
    const doc = docWith([{ ...group("g", {}, ["a", "b"]), shadow: groupShadow }], [rect("a", {}), { ...rect("b", { x: 200 }), shadow: childShadow }]);
    const { ctx, calls } = recordingContext();
    renderDoc(ctx, doc, identity, opts, { background: false });
    const colors = calls.filter((c) => c.op === "set:shadowColor" && c.args[0] !== "transparent").map((c) => c.args[0]);
    expect(colors).toEqual([groupShadow.color, childShadow.color]);
  });

  it("draws dashed strokes with dashes of 3 and 2 stroke widths, then resets the dash", () => {
    const { ctx, calls } = recordingContext();
    const n = { ...rect("a", {}), stroke: { color: "#000000", width: 2, dash: "dashed" as const } };
    renderDoc(ctx, docWith([n]), identity, opts, { background: false });
    expect(calls.filter((c) => c.op === "setLineDash" || c.op === "set:lineCap").map((c) => [c.op, c.args[0]])).toEqual([
      ["setLineDash", [6, 4]],
      ["setLineDash", []],
      ["set:lineCap", "butt"],
    ]);
  });

  it("draws dotted strokes as round dots of zero length, then resets the cap and dash", () => {
    const { ctx, calls } = recordingContext();
    const n = { ...rect("a", {}), stroke: { color: "#000000", width: 2, dash: "dotted" as const } };
    renderDoc(ctx, docWith([n]), identity, opts, { background: false });
    expect(calls.filter((c) => c.op === "setLineDash" || c.op === "set:lineCap").map((c) => [c.op, c.args[0]])).toEqual([
      ["setLineDash", [0, 4]],
      ["set:lineCap", "round"],
      ["setLineDash", []],
      ["set:lineCap", "butt"],
    ]);
  });

  it("leaves solid and missing dashes as plain strokes", () => {
    const { ctx, calls } = recordingContext();
    const solid = { ...rect("a", {}), stroke: { color: "#000000", width: 2 } };
    renderDoc(ctx, docWith([solid]), identity, opts, { background: false });
    expect(calls.some((c) => c.op === "setLineDash" || c.op === "set:lineCap")).toBe(false);
  });
});
