import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, uploadPhoto } from "@/lib/api";
import { parseDraggedPhoto, toAssetRef, uploadAll } from "./photo-actions";

vi.mock("@/lib/api", async (real) => ({ ...(await real<object>()), uploadPhoto: vi.fn() }));

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

describe("uploadAll", () => {
  const file = (name: string) => new File(["x"], name, { type: "image/jpeg" });
  const photo = (id: string) => ({ id, kind: "photo", mime: "image/jpeg", bytes: 1, width: 4, height: 3, createdAt: "" });
  const upload = vi.mocked(uploadPhoto);
  beforeEach(() => {
    upload.mockReset();
    // Tests run in Node; the uploader announces new photos on window.
    vi.stubGlobal("window", new EventTarget());
  });

  it("offers another try only for connection and server failures", async () => {
    upload
      .mockResolvedValueOnce(photo("p1"))
      .mockRejectedValueOnce(new ApiError(0, "b.jpg couldn't be uploaded. Check your connection and try again."))
      .mockRejectedValueOnce(new ApiError(415, "c.gif: use a JPEG, PNG or WebP photo."))
      .mockRejectedValueOnce(new ApiError(503, "Something went wrong. Please try again."))
      .mockRejectedValueOnce(new ApiError(0, "b.jpg couldn't be uploaded. Check your connection and try again."));
    const files = [file("a.jpg"), file("b.jpg"), file("c.gif"), file("d.jpg"), file("b.jpg")];
    const r = await uploadAll(files, () => {});
    expect(r.photos.map((p) => p.id)).toEqual(["p1"]);
    expect(r.errors).toHaveLength(3);
    expect(r.retry).toEqual([files[1], files[3], files[4]]);
    expect(r.full).toBe(false);
  });

  it("stops once storage is full, with one message for the rest", async () => {
    upload.mockResolvedValueOnce(photo("p1")).mockRejectedValueOnce(new ApiError(422, "This upload would go over your 50 MB of storage. Delete some photos to make room.", { limitBytes: 50 }));
    const r = await uploadAll([file("a.jpg"), file("b.jpg"), file("c.jpg"), file("d.jpg")], () => {});
    expect(upload).toHaveBeenCalledTimes(2);
    expect(r.full).toBe(true);
    expect(r.retry).toEqual([]);
    expect(r.errors).toEqual(["This upload would go over your 50 MB of storage. Delete some photos to make room. 3 photos weren't uploaded."]);
  });
});
