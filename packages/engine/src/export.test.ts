import { describe, expect, it } from "vitest";
import { checkExport } from "./export";
import { recordingContext } from "./recording-ctx";
import { renderDoc } from "./render";
import { docWith } from "./test-docs";

describe("checkExport", () => {
  it("gives the output size for a scale", () => {
    expect(checkExport(docWith([]), 2)).toEqual({ ok: true, width: 2000, height: 2000 });
  });

  it("refuses sizes over 8192 px per side and suggests the largest scale that fits", () => {
    const story = { ...docWith([]), artboard: { ...docWith([]).artboard, width: 1080, height: 1920 } };
    expect(checkExport(story, 3)).toEqual({ ok: true, width: 3240, height: 5760 });
    const huge = { ...story, artboard: { ...story.artboard, width: 4000, height: 3000 } };
    expect(checkExport(huge, 3)).toEqual({ ok: false, reason: expect.stringMatching(/8192/), maxScale: 2 });
  });
});

describe("renderDoc background option", () => {
  it("skips the background fill for a transparent export", () => {
    const withBg = recordingContext();
    renderDoc(withBg.ctx, docWith([]), [1, 0, 0, 1, 0, 0], { measure: () => 0, image: () => "loading", dpr: 1 });
    const transparent = recordingContext();
    renderDoc(transparent.ctx, docWith([]), [1, 0, 0, 1, 0, 0], { measure: () => 0, image: () => "loading", dpr: 1 }, { background: false });
    expect(withBg.calls.filter((c) => c.op === "fillRect")).toHaveLength(1);
    expect(transparent.calls.filter((c) => c.op === "fillRect")).toHaveLength(0);
  });
});
