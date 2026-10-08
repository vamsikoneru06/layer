import { describe, expect, it } from "vitest";
import { placePopover, placeToolbar } from "./toolbar-position";

const view = { width: 1000, height: 700 };
const toolbar = { width: 300, height: 40 };
/** Handles of a 200 x 100 frame at (400, 300), with the rotate handle 24 above its top edge. */
const frame = (x: number, y: number) => [
  { x, y },
  { x: x + 200, y },
  { x, y: y + 100 },
  { x: x + 200, y: y + 100 },
  { x: x + 100, y: y - 24 },
];

describe("placeToolbar", () => {
  it("sits above the frame and its rotate handle, centred on it", () => {
    // top of everything is the rotate handle at y = 276; 10 gap and 40 height leave y = 226
    expect(placeToolbar(frame(400, 300), toolbar, view)).toEqual({ x: 350, y: 226, side: "above" });
  });

  it("goes below the frame when there is no room above", () => {
    expect(placeToolbar(frame(400, 40), toolbar, view)).toEqual({ x: 350, y: 40 + 100 + 10, side: "below" });
  });

  it("keeps the margin from the top edge when the toolbar just fits", () => {
    const p = placeToolbar(frame(400, 82), toolbar, view);
    expect(p).toEqual({ x: 350, y: 8, side: "above" });
  });

  it("stays at the top, over the selection, when neither side has room", () => {
    const tall = [
      { x: 400, y: 0 },
      { x: 600, y: 700 },
    ];
    expect(placeToolbar(tall, toolbar, view)).toEqual({ x: 350, y: 8, side: "above" });
  });

  it("is clamped inside the view on the left and right", () => {
    expect(placeToolbar(frame(0, 300), toolbar, view).x).toBe(8);
    expect(placeToolbar(frame(800, 300), toolbar, view).x).toBe(1000 - 300 - 8);
  });

  it("uses a rotated frame's real top, not its box's centre line", () => {
    // a diamond: its highest point is the top handle at y = 200
    const diamond = [
      { x: 500, y: 200 },
      { x: 600, y: 300 },
      { x: 500, y: 400 },
      { x: 400, y: 300 },
    ];
    expect(placeToolbar(diamond, toolbar, view).y).toBe(200 - 10 - 40);
  });

  it("copes with a view smaller than the toolbar", () => {
    expect(placeToolbar(frame(10, 10), toolbar, { width: 200, height: 30 })).toEqual({ x: 8, y: 8, side: "above" });
  });
});

describe("placePopover", () => {
  const anchor = { left: 400, top: 100, right: 432, bottom: 132 };
  const pop = { width: 220, height: 120 };

  it("opens under the button, centred on it", () => {
    expect(placePopover(anchor, pop, view)).toEqual({ x: 416 - 110, y: 132 + 6 });
  });

  it("opens above the button when there is no room below", () => {
    const low = { left: 400, top: 650, right: 432, bottom: 682 };
    expect(placePopover(low, pop, view)).toEqual({ x: 306, y: 650 - 6 - 120 });
  });

  it("is clamped inside the window sideways", () => {
    expect(placePopover({ left: 0, top: 100, right: 32, bottom: 132 }, pop, view).x).toBe(8);
    expect(placePopover({ left: 968, top: 100, right: 1000, bottom: 132 }, pop, view).x).toBe(1000 - 220 - 8);
  });
});
