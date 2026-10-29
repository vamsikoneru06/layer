import { describe, expect, it } from "vitest";
import { dropIndex, layerName } from "./layer-order";

describe("layerName", () => {
  it("shows the layer's own name, trimmed of nothing it chose", () => {
    expect(layerName({ name: "Headline", type: "text" })).toBe("Headline");
  });

  it("falls back to a readable name for the kind", () => {
    expect(layerName({ name: "", type: "frame" })).toBe("Photo");
    expect(layerName({ name: "  ", type: "text" })).toBe("Text");
    expect(layerName({ name: "", type: "shape" })).toBe("Shape");
    expect(layerName({ name: "", type: "sticker" })).toBe("Sticker");
    expect(layerName({ name: "", type: "group" })).toBe("Group");
  });
});

describe("dropIndex", () => {
  // Bottom to top: the panel shows e, d, c, b, a from the top.
  const list = ["a", "b", "c", "d", "e"];

  it("a line above a row puts the layer in front of it", () => {
    expect(dropIndex(list, "a", "d", "above")).toBe(3); // a goes above d: b c d a e
    expect(dropIndex(list, "a", "e", "above")).toBe(4); // to the very top
  });

  it("a line below a row puts the layer behind it", () => {
    expect(dropIndex(list, "e", "b", "below")).toBe(1); // e goes just under b: a e b c d
    expect(dropIndex(list, "e", "a", "below")).toBe(0); // to the very bottom
  });

  it("works moving down with a line above and moving up with a line below", () => {
    expect(dropIndex(list, "d", "b", "above")).toBe(2); // d above b: a b d c e
    expect(dropIndex(list, "b", "d", "below")).toBe(2); // b below d: a c b d e
  });

  it("gives nothing for a drop that changes nothing", () => {
    expect(dropIndex(list, "c", "b", "above")).toBeNull(); // c is already above b
    expect(dropIndex(list, "c", "d", "below")).toBeNull(); // and already below d
    expect(dropIndex(list, "c", "c", "above")).toBeNull();
  });

  it("gives nothing for layers outside the list", () => {
    expect(dropIndex(list, "x", "b", "above")).toBeNull();
    expect(dropIndex(list, "a", "x", "above")).toBeNull();
  });

  it("always lands the layer right next to the one it was dropped on, on the drawn side", () => {
    for (const dragged of list) {
      for (const over of list) {
        for (const edge of ["above", "below"] as const) {
          const index = dropIndex(list, dragged, over, edge);
          if (index === null) continue;
          const rest = list.filter((id) => id !== dragged);
          const result = [...rest.slice(0, index), dragged, ...rest.slice(index)];
          // Higher in the list is higher on the screen.
          expect(result.indexOf(dragged) - result.indexOf(over)).toBe(edge === "above" ? 1 : -1);
        }
      }
    }
  });
});
