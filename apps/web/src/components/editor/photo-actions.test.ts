import { describe, expect, it } from "vitest";
import { parseDraggedPhoto, toAssetRef } from "./photo-actions";

const ref = { id: "a1", kind: "photo", mime: "image/jpeg", width: 40, height: 30 };

describe("toAssetRef", () => {
  it("needs the photo's size and a supported type", () => {
    const photo = { ...ref, bytes: 10, createdAt: "2026-10-04T00:00:00Z" };
    expect(toAssetRef(photo)).toEqual(ref);
    expect(toAssetRef({ ...photo, width: null })).toBeNull();
    expect(toAssetRef({ ...photo, mime: "image/svg+xml" })).toBeNull();
  });
});

describe("parseDraggedPhoto", () => {
  it("accepts what the Photos panel sends, and nothing else", () => {
    expect(parseDraggedPhoto(JSON.stringify(ref))).toEqual(ref);
    expect(parseDraggedPhoto(JSON.stringify({ ...ref, extra: "<script>" }))).toEqual(ref);
    for (const bad of ["not json", "null", JSON.stringify({ ...ref, id: "../x" }), JSON.stringify({ ...ref, kind: "sticker" }), JSON.stringify({ ...ref, width: -1 }), JSON.stringify({ ...ref, mime: "text/html" })]) {
      expect(parseDraggedPhoto(bad)).toBeNull();
    }
  });
});
