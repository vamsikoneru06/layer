import { describe, expect, it } from "vitest";
import { masonry } from "./masonry";

describe("masonry", () => {
  it("puts each item in the shortest column, keeping the order across", () => {
    // Heights: a tall, then three short.
    const items = [{ id: "tall", h: 2 }, { id: "a", h: 1 }, { id: "b", h: 1 }, { id: "c", h: 1 }];
    expect(masonry(items, 2, (i) => i.h).map((c) => c.map((i) => i.id))).toEqual([["tall", "c"], ["a", "b"]]); // A tie goes to the left column.
  });

  it("fills a row first when items are the same height", () => {
    expect(masonry([1, 2, 3, 4, 5], 3, () => 1)).toEqual([[1, 4], [2, 5], [3]]);
  });

  it("copes with no items and at least one column", () => {
    expect(masonry([], 3, () => 1)).toEqual([[], [], []]);
    expect(masonry([1, 2], 0, () => 1)).toEqual([[1, 2]]);
  });
});
