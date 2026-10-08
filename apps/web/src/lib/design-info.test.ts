import { createEmptyDoc } from "@vash/schema";
import { describe, expect, it } from "vitest";
import { describeDesign } from "./design-info";

const doc = createEmptyDoc({ id: "d1", kind: "design", title: "Test", format: "ig-post" });

describe("describeDesign", () => {
  it("lists the size, format, layer count and last save", () => {
    const rows = describeDesign(doc, "2026-09-29T10:15:00.000Z", "en-US");
    expect(rows.map((r) => r.label)).toEqual(["Size", "Format", "Layers", "Last saved"]);
    expect(rows[0]!.value).toBe(`${doc.artboard.width} × ${doc.artboard.height} px`);
    expect(rows[1]!.value).toBe("Post");
    expect(rows[2]!.value).toBe("0");
    expect(rows[3]!.value).toMatch(/2026/);
  });

  it("says so when the save time is unknown", () => {
    expect(describeDesign(doc, "not a date")[3]!.value).toBe("Not saved yet");
  });
});
