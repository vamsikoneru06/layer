import { applyCommand } from "@vash/engine";
import { createEmptyDoc, defaultFilters, type AssetRef, type Doc, type Fill, type Node } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { backgroundCommand, imageFill } from "./background-image";
import { convertFill, fillCss } from "./color";

const PHOTO: AssetRef = { id: "p1", kind: "photo", mime: "image/jpeg", width: 2000, height: 1000 };
const SOLID: Fill = { type: "solid", color: "#112233" };
const transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

/** A 1000 px square design with a background, and optionally a photo frame that shows the photo `p1`. */
function designWith(background: Fill, showPhotoInFrame = false): Doc {
  const doc = createEmptyDoc({ id: "d1", kind: "design", title: "Test", format: "custom", size: { width: 1000, height: 1000 } });
  doc.artboard.background = background;
  if (background.type === "image") doc.assets[background.assetId] = { ...PHOTO, id: background.assetId };
  if (showPhotoInFrame) {
    doc.assets[PHOTO.id] = PHOTO;
    const frame: Node = {
      id: "f1", type: "frame", name: "Photo", transform, width: 400, height: 400, opacity: 1, visible: true, lock: "free",
      shape: { kind: "rect", cornerRadius: 0 }, content: { assetId: PHOTO.id, offsetX: 0, offsetY: 0, scale: 1 }, filters: defaultFilters(), placeholder: false,
    };
    doc.nodes.f1 = frame;
    doc.root = ["f1"];
  }
  return doc;
}

describe("image fills in the colour helpers", () => {
  it("previews a photo as a neutral grey", () => {
    expect(fillCss(imageFill("p1"))).toBe("#E5E5EA");
  });

  it("turns a photo back into a solid white, or into a white-to-dark gradient", () => {
    expect(convertFill(imageFill("p1"), "solid")).toEqual({ type: "solid", color: "#FFFFFF" });
    expect(convertFill(imageFill("p1"), "linear")).toEqual({
      type: "linear", angle: 90, stops: [{ offset: 0, color: "#FFFFFF" }, { offset: 1, color: "#1D1D1F" }],
    });
  });

  it("makes a cover-fit photo fill", () => {
    expect(imageFill("p1")).toEqual({ type: "image", assetId: "p1", fit: "cover" });
  });
});

describe("backgroundCommand", () => {
  it("adds a picked photo to the asset list and sets it as the background, as one undo step", () => {
    const doc = designWith(SOLID);
    const cmd = backgroundCommand(doc, imageFill(PHOTO.id), PHOTO);
    expect(cmd).toEqual({
      type: "batch",
      commands: [
        { type: "asset", id: "p1", ref: PHOTO },
        { type: "artboard", patch: { background: imageFill("p1") } },
      ],
    });
    const next = applyCommand(doc, cmd).doc;
    expect(next.assets.p1).toEqual(PHOTO);
    expect(next.artboard.background).toEqual(imageFill("p1"));
  });

  it("only sets the background when the photo is already in the asset list", () => {
    const doc = designWith(SOLID, true);
    expect(backgroundCommand(doc, imageFill(PHOTO.id), PHOTO)).toEqual({ type: "artboard", patch: { background: imageFill("p1") } });
  });

  it("returns to a solid fill and drops the photo when no layer shows it", () => {
    const doc = designWith(imageFill("p1"));
    const cmd = backgroundCommand(doc, convertFill(doc.artboard.background, "solid"));
    expect(cmd).toEqual({
      type: "batch",
      commands: [
        { type: "artboard", patch: { background: { type: "solid", color: "#FFFFFF" } } },
        { type: "asset", id: "p1", ref: null },
      ],
    });
    const next = applyCommand(doc, cmd).doc;
    expect(next.artboard.background).toEqual({ type: "solid", color: "#FFFFFF" });
    expect(next.assets.p1).toBeUndefined();
  });

  it("keeps the photo when a frame still shows it", () => {
    const doc = designWith(imageFill("p1"), true);
    expect(backgroundCommand(doc, SOLID)).toEqual({ type: "artboard", patch: { background: SOLID } });
  });

  it("drops the old photo when a new one replaces it, and keeps the same photo when re-picked", () => {
    const doc = designWith(imageFill("old"));
    const replaced = applyCommand(doc, backgroundCommand(doc, imageFill(PHOTO.id), PHOTO)).doc;
    expect(replaced.assets.old).toBeUndefined();
    expect(replaced.assets.p1).toEqual(PHOTO);

    const same = designWith(imageFill("p1"));
    expect(backgroundCommand(same, imageFill("p1"), PHOTO)).toEqual({ type: "artboard", patch: { background: imageFill("p1") } });
  });

  it("changes between solid and gradient as a single artboard change", () => {
    const doc = designWith(SOLID);
    const gradient = convertFill(SOLID, "linear");
    expect(backgroundCommand(doc, gradient)).toEqual({ type: "artboard", patch: { background: gradient } });
  });
});
