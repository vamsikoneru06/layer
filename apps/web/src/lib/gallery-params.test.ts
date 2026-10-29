import { describe, expect, it } from "vitest";
import { galleryQuery, readGalleryParams } from "./gallery-params";

describe("gallery URL filters", () => {
  it("reads known filters and round-trips them", () => {
    const f = readGalleryParams(new URLSearchParams("q=menu&category=menus&format=ig-story&sort=new"));
    expect(f).toEqual({ q: "menu", category: "menus", format: "ig-story", sort: "new" });
    expect(galleryQuery(f)).toBe("?q=menu&category=menus&format=ig-story&sort=new");
  });

  it("drops unknown values and keeps the plain gallery URL clean", () => {
    const f = readGalleryParams(new URLSearchParams("category=nope&format=billboard&sort=random"));
    expect(f).toEqual({ q: "", category: null, format: "", sort: "popular" });
    expect(galleryQuery(f)).toBe("");
  });
});
