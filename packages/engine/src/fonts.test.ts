import { describe, expect, it } from "vitest";
import { fontRequests } from "./fonts";
import { docWith, group, rect, text } from "./test-docs";

describe("fontRequests", () => {
  it("lists each distinct font a document's text uses, including text inside groups", () => {
    const bold = { ...text("b", {}), font: { family: "Poppins", weight: 700, style: "normal" as const } };
    const doc = docWith([text("a", {}), bold, rect("r", {}), group("g", {}, ["c"])], [{ ...text("c", {}), font: { family: "Caveat", weight: 400, style: "italic" as const } }]);
    expect(fontRequests(doc)).toEqual(['normal 400 16px "Inter"', 'normal 700 16px "Poppins"', 'italic 400 16px "Caveat"']);
  });
});
