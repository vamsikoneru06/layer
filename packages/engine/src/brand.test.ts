import type { Doc, ShapeNode, TextNode } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { planBrandKit } from "./brand";
import { applyCommand } from "./commands";
import { History } from "./history";
import { docWith, frame, rect, text } from "./test-docs";

const shape = (id: string, color: string, size: number, extra: Partial<ShapeNode> = {}): ShapeNode => ({ ...rect(id, {}, size, size), fill: { type: "solid", color }, ...extra });
const words = (id: string, family: string, size: number, color = "#111111", extra: Partial<TextNode> = {}): TextNode => ({
  ...text(id, {}),
  font: { family, weight: 400, style: "normal" },
  size,
  color,
  ...extra,
});
const apply = (doc: Doc, plan: ReturnType<typeof planBrandKit>) => (plan.command ? applyCommand(doc, plan.command).doc : doc);
const withBackground = (doc: Doc, background: Doc["artboard"]["background"]): Doc => ({ ...doc, artboard: { ...doc.artboard, background } });
const at = (x: number, y: number) => ({ transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 } });
/** WCAG contrast, written out here so the test doesn't trust the code under test. */
const contrast = (a: string, b: string) => {
  const lum = (c: string) =>
    [1, 3, 5]
      .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe("planBrandKit", () => {
  it("maps the design's colours, most-covered first, onto the kit's colours", () => {
    const doc = docWith([shape("big", "#2266AA", 400), shape("small", "#CC3300", 100), shape("also-small", "#CC3300", 50), words("t", "Inter", 40, "#2266AA")]);
    const next = apply(doc, planBrandKit(doc, { colors: ["#FF7A1A", "#0E1B2E"], fonts: [] }, "design"));
    expect((next.nodes.big as ShapeNode).fill).toEqual({ type: "solid", color: "#FF7A1A" });
    expect((next.nodes.small as ShapeNode).fill).toEqual({ type: "solid", color: "#0E1B2E" });
    expect((next.nodes["also-small"] as ShapeNode).fill).toEqual({ type: "solid", color: "#0E1B2E" });
    expect((next.nodes.t as TextNode).color).toBe("#FF7A1A");
  });

  it("leaves near-black and near-white alone so text stays readable, and keeps transparency", () => {
    const doc = docWith([shape("ink", "#0A0A0A", 900), shape("paper", "#FDFDFD", 800), shape("tint", "#33669980", 100)]);
    const next = apply(doc, planBrandKit(doc, { colors: ["#FF7A1A"], fonts: [] }, "design"));
    expect((next.nodes.ink as ShapeNode).fill).toEqual({ type: "solid", color: "#0A0A0A" });
    expect((next.nodes.paper as ShapeNode).fill).toEqual({ type: "solid", color: "#FDFDFD" });
    expect((next.nodes.tint as ShapeNode).fill).toEqual({ type: "solid", color: "#FF7A1A80" });
  });

  it("recolours gradients, strokes and the background with the same mapping", () => {
    const base = docWith([shape("g", "#2266AA", 200, { fill: { type: "linear", angle: 90, stops: [{ offset: 0, color: "#2266AA" }, { offset: 1, color: "#CC3300" }] }, stroke: { color: "#CC3300", width: 4 } })]);
    const doc: Doc = { ...base, artboard: { ...base.artboard, background: { type: "solid", color: "#2266AA" } } };
    const next = apply(doc, planBrandKit(doc, { colors: ["#111FFF", "#EEE000"], fonts: [] }, "design"));
    expect(next.artboard.background).toEqual({ type: "solid", color: "#111FFF" });
    const g = next.nodes.g as ShapeNode;
    expect(g.fill).toEqual({ type: "linear", angle: 90, stops: [{ offset: 0, color: "#111FFF" }, { offset: 1, color: "#EEE000" }] });
    expect(g.stroke).toEqual({ color: "#EEE000", width: 4 });
  });

  it("gives the biggest text's font to headings and the second kit font to the rest", () => {
    const doc = docWith([words("title", "Bebas Neue", 120), words("sub", "Inter", 30), words("note", "Lora", 24), words("title2", "Bebas Neue", 60)]);
    const next = apply(doc, planBrandKit(doc, { colors: [], fonts: ["Playfair Display", "Poppins"] }, "design"));
    expect((next.nodes.title as TextNode).font.family).toBe("Playfair Display");
    expect((next.nodes.title2 as TextNode).font.family).toBe("Playfair Display");
    expect((next.nodes.sub as TextNode).font.family).toBe("Poppins");
    expect((next.nodes.note as TextNode).font.family).toBe("Poppins");
    // One kit font: every text uses it. Weight and style are kept.
    const single = apply(doc, planBrandKit(doc, { colors: [], fonts: ["Oswald"] }, "design"));
    expect(Object.values(single.nodes).map((n) => (n as TextNode).font)).toEqual(Array(4).fill({ family: "Oswald", weight: 400, style: "normal" }));
  });

  it("skips layers the template locked, counting them, and changes nothing when the kit is empty", () => {
    const doc = docWith([shape("deco", "#2266AA", 400, { lock: "locked" }), words("t", "Inter", 40, "#2266AA", { lock: "content-only" })]);
    const plan = planBrandKit(doc, { colors: ["#FF7A1A"], fonts: ["Lora"] }, "design");
    expect(plan.skippedLocked).toBe(1);
    const next = apply(doc, plan);
    expect((next.nodes.deco as ShapeNode).fill).toEqual({ type: "solid", color: "#2266AA" });
    expect(next.nodes.t).toMatchObject({ color: "#FF7A1A", font: { family: "Lora" } });
    // Author Mode may restyle everything.
    expect(planBrandKit(doc, { colors: ["#FF7A1A"], fonts: [] }, "template").skippedLocked).toBe(0);
    expect(planBrandKit(doc, { colors: [], fonts: [] }, "design")).toEqual({ command: null, changed: 0, background: false, skippedLocked: 0 });
  });

  it("treats close shades as one colour, so a soft gradient stays one colour in lighter and darker tones", () => {
    const doc = withBackground(docWith([words("title", "Caveat", 110, "#5B3A29"), words("body", "Inter", 34, "#6F4E37")]), {
      type: "linear",
      angle: 180,
      stops: [{ offset: 0, color: "#F3E9DC" }, { offset: 1, color: "#E6D3BD" }],
    });
    const plan = planBrandKit(doc, { colors: ["#FF7A1A", "#0E1B2E"], fonts: [] }, "design");
    const next = apply(doc, plan);
    const stops = next.artboard.background.type === "linear" ? next.artboard.background.stops.map((s) => s.color) : [];
    expect(stops[0]).toBe("#FF7A1A");
    // The darker cream becomes a darker orange, not the kit's second colour.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(stops[1]!.slice(i, i + 2), 16));
    expect(r! > g! && g! > b!).toBe(true);
    expect(r! + g! + b!).toBeLessThan(0xff + 0x7a + 0x1a);
    // The browns are the second family: they take the second colour and stay readable on the new background.
    expect((next.nodes.title as TextNode).color).toBe("#0E1B2E");
    for (const id of ["title", "body"]) for (const stop of stops) expect(contrast((next.nodes[id] as TextNode).color, stop)).toBeGreaterThanOrEqual(4.5);
    expect(plan).toMatchObject({ changed: 2, background: true });
  });

  it("gives text a colour that reads when its background takes a kit colour it would disappear on", () => {
    const doc = withBackground(docWith([words("t", "Inter", 30, "#5B3A29CC")]), { type: "solid", color: "#F3E9DC" });
    const next = apply(doc, planBrandKit(doc, { colors: ["#0E1B2E"], fonts: [] }, "design"));
    expect(next.artboard.background).toEqual({ type: "solid", color: "#0E1B2E" });
    expect((next.nodes.t as TextNode).color).toBe("#FFFFFFCC");
  });

  it("checks text against the shape it sits on, and leaves text over a photo alone", () => {
    const doc = docWith([
      shape("card", "#F3E9DC", 400),
      words("on-card", "Inter", 30, "#5B3A29"),
      frame("photo", { x: 800, y: 800 }, 300, 300),
      words("on-photo", "Inter", 30, "#5B3A29", at(800, 800)),
    ]);
    const plan = planBrandKit(doc, { colors: ["#0E1B2E"], fonts: [] }, "design");
    const next = apply(doc, plan);
    expect((next.nodes.card as ShapeNode).fill).toEqual({ type: "solid", color: "#0E1B2E" });
    expect((next.nodes["on-card"] as TextNode).color).toBe("#FFFFFF");
    expect((next.nodes["on-photo"] as TextNode).color).toBe("#5B3A29");
    expect(plan).toMatchObject({ changed: 2, background: false });
  });

  it("is one undo step", () => {
    const doc = docWith([shape("a", "#2266AA", 400), words("t", "Inter", 40, "#2266AA")]);
    const history = new History(doc);
    history.execute(planBrandKit(doc, { colors: ["#FF7A1A"], fonts: ["Lora"] }, "design").command!);
    expect((history.doc.nodes.a as ShapeNode).fill).toEqual({ type: "solid", color: "#FF7A1A" });
    history.undo();
    expect(history.doc).toEqual(doc);
  });
});
