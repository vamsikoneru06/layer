import { defaultFilters, type AssetRef, type FrameNode } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { EditorCore } from "./editor-core";
import { runPlan } from "./edit-ops";
import { LOCKED } from "./policy";
import { planReplacePhoto, planResetFilters } from "./photo-ops";
import { docWith, frame, rect } from "./test-docs";

const photo = (id: string, width = 400, height = 200): AssetRef => ({ id, kind: "photo", mime: "image/jpeg", width, height });

/** A frame holding `assetId`, with the given filters. */
const placed = (id: string, assetId: string, t: Partial<FrameNode> = {}): FrameNode => ({
  ...frame(id, { x: 300, y: 300 }, 200, 100),
  placeholder: false,
  content: { assetId, offsetX: 10, offsetY: 0, scale: 1.5 },
  ...t,
});

const adjusted = () => ({
  ...defaultFilters(),
  preset: "warm",
  warmth: 0.35,
  saturation: 0.1,
  duotone: { light: "#FFFFFF", dark: "#000000" },
  pixelate: 30,
});

/** A design with one photo frame ("f") holding asset "old", and the asset registered. */
const withPhoto = (f: FrameNode = { ...placed("f", "old"), filters: adjusted() }) => {
  const doc = docWith([f, rect("r", { x: 700, y: 700 })]);
  doc.assets = { old: photo("old") };
  return doc;
};

describe("planResetFilters", () => {
  it("sets the selected frames back to defaults, clearing duotone and pixelate, and keeps the photo", () => {
    const core = new EditorCore(withPhoto());
    core.select(["f"]);
    expect(runPlan(core, planResetFilters(core.doc, ["f"], "design"))).toBe(true);
    const f = core.doc.nodes.f as FrameNode;
    expect(f.filters).toEqual(defaultFilters());
    expect(f.filters.duotone ?? null).toBeNull();
    expect(f.filters.pixelate ?? 0).toBe(0);
    expect(f.content).toEqual({ assetId: "old", offsetX: 10, offsetY: 0, scale: 1.5 });
    expect(core.getState().selection).toEqual(["f"]);
  });

  it("is one undo step", () => {
    const core = new EditorCore(withPhoto());
    const before = core.doc;
    core.select(["f"]);
    runPlan(core, planResetFilters(core.doc, ["f"], "design"));
    core.undo();
    expect(core.doc).toEqual(before);
    expect(core.getState().canUndo).toBe(false);
  });

  it("only changes the selected frames that have adjustments", () => {
    const doc = withPhoto();
    doc.nodes.g = { ...placed("g", "old"), filters: { ...defaultFilters(), warmth: 0.2 } };
    doc.nodes.h = placed("h", "old");
    doc.root = [...doc.root, "g", "h"];
    const plan = planResetFilters(doc, ["f", "g", "h"], "design");
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.command).toEqual({ type: "batch", commands: [expect.objectContaining({ id: "f" }), expect.objectContaining({ id: "g" })] });
  });

  it("refuses when no photo frame is selected", () => {
    const doc = withPhoto();
    expect(planResetFilters(doc, [], "design")).toEqual({ ok: false, reason: "Select a photo first." });
    expect(planResetFilters(doc, ["r"], "design")).toEqual({ ok: false, reason: "Select a photo first." });
  });

  it("refuses when the photo has no adjustments", () => {
    const doc = withPhoto(placed("f", "old"));
    expect(planResetFilters(doc, ["f"], "design")).toEqual({ ok: false, reason: "This photo has no adjustments to reset." });
  });

  it("refuses a locked frame, and allows one that is only content-locked", () => {
    const locked = withPhoto({ ...placed("f", "old"), filters: adjusted(), lock: "locked" });
    expect(planResetFilters(locked, ["f"], "design")).toEqual({ ok: false, reason: LOCKED });
    const contentOnly = withPhoto({ ...placed("f", "old"), filters: adjusted(), lock: "content-only" });
    expect(planResetFilters(contentOnly, ["f"], "design").ok).toBe(true);
  });
});

describe("planReplacePhoto", () => {
  it("swaps the asset and keeps the offset, zoom and filters", () => {
    const core = new EditorCore(withPhoto());
    core.select(["f"]);
    expect(runPlan(core, planReplacePhoto(core.doc, "f", photo("fresh"), "design"))).toBe(true);
    const f = core.doc.nodes.f as FrameNode;
    expect(f.content).toEqual({ assetId: "fresh", offsetX: 10, offsetY: 0, scale: 1.5 });
    expect(f.filters).toEqual(adjusted());
    expect(core.doc.assets.fresh).toEqual(photo("fresh"));
    expect(core.doc.assets.old).toBeUndefined();
    expect(core.getState().selection).toEqual(["f"]);
  });

  it("keeps an old photo that another frame still shows", () => {
    const doc = withPhoto();
    doc.nodes.g = placed("g", "old");
    doc.root = [...doc.root, "g"];
    const core = new EditorCore(doc);
    core.select(["f"]);
    expect(runPlan(core, planReplacePhoto(core.doc, "f", photo("fresh"), "design"))).toBe(true);
    expect(core.doc.assets.old).toEqual(photo("old"));
    expect(core.doc.assets.fresh).toEqual(photo("fresh"));
  });

  it("clamps the offset when the new photo would show an empty edge", () => {
    const doc = withPhoto({ ...placed("f", "old"), content: { assetId: "old", offsetX: 0, offsetY: 20, scale: 1 } });
    const plan = planReplacePhoto(doc, "f", photo("wide", 1000, 100), "design");
    expect(plan.ok).toBe(true);
    const core = new EditorCore(doc);
    core.select(["f"]);
    runPlan(core, plan);
    expect((core.doc.nodes.f as FrameNode).content).toEqual({ assetId: "wide", offsetX: 0, offsetY: 0, scale: 1 });
  });

  it("is one undo step, restoring the old photo", () => {
    const core = new EditorCore(withPhoto());
    const before = core.doc;
    core.select(["f"]);
    runPlan(core, planReplacePhoto(core.doc, "f", photo("fresh"), "design"));
    core.undo();
    expect(core.doc).toEqual(before);
    expect(core.getState().canUndo).toBe(false);
  });

  it("refuses a frame with no photo yet, the same photo, and a layer that is not a frame", () => {
    const empty = withPhoto({ ...placed("f", "old"), content: null });
    expect(planReplacePhoto(empty, "f", photo("fresh"), "design")).toEqual({ ok: false, reason: "Drop a photo onto the frame first." });
    const doc = withPhoto();
    expect(planReplacePhoto(doc, "f", photo("old"), "design")).toEqual({ ok: false, reason: "That photo is already in this frame." });
    expect(planReplacePhoto(doc, "r", photo("fresh"), "design")).toEqual({ ok: false, reason: "Select a photo first." });
  });

  it("refuses a locked frame and leaves the design unchanged", () => {
    const doc = withPhoto({ ...placed("f", "old"), lock: "locked" });
    expect(planReplacePhoto(doc, "f", photo("fresh"), "design")).toEqual({ ok: false, reason: LOCKED });
    const core = new EditorCore(doc);
    core.select(["f"]);
    expect(runPlan(core, planReplacePhoto(doc, "f", photo("fresh"), "design"))).toBe(false);
    expect(core.getState().notice).toBe(LOCKED);
    expect(core.doc).toEqual(doc);
  });

  it("is allowed on a content-only lock, since only the photo changes", () => {
    const doc = withPhoto({ ...placed("f", "old"), lock: "content-only" });
    expect(planReplacePhoto(doc, "f", photo("fresh"), "design").ok).toBe(true);
  });
});
