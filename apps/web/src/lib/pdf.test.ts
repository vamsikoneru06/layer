import { describe, expect, it } from "vitest";
import { jpegToPdf, pointsFromPixels } from "./pdf";

// Fake JPEG bytes that include values a text-based writer would corrupt.
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x0d, 0x0a, 0x00, 0x1a, 0x80, 0xff, 0x25, 0x0a, 0xfe, 0x00, 0xff, 0xd9,
]);
const IMAGE = { width: 800, height: 600 };
const PAGE = { width: 612, height: 792 };

// One byte per character, so string indexes equal byte offsets.
function asText(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

describe("jpegToPdf", () => {
  const pdf = jpegToPdf(JPEG, IMAGE, PAGE);
  const text = asText(pdf);

  it("starts with the PDF 1.4 header and ends with %%EOF", () => {
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);
  });

  it("points every xref entry at the start of its object", () => {
    const xrefAt = text.indexOf("xref\n");
    const entries = [...text.slice(xrefAt).matchAll(/(\d{10}) 00000 n \n/g)];
    expect(entries).toHaveLength(5);
    entries.forEach((entry, i) => {
      const offset = Number(entry[1]);
      expect(text.startsWith(`${i + 1} 0 obj`, offset)).toBe(true);
    });
  });

  it("writes a startxref that points at the xref table, and a trailer", () => {
    const match = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
    expect(match).not.toBeNull();
    expect(text.startsWith("xref", Number(match?.[1]))).toBe(true);
    expect(text).toContain("trailer\n<< /Size 6 /Root 1 0 R >>");
  });

  it("keeps the JPEG bytes unchanged inside the image object", () => {
    const at = indexOfBytes(pdf, JPEG);
    expect(at).toBeGreaterThan(0);
    expect(pdf.slice(at, at + JPEG.length)).toEqual(JPEG);
    expect(text.slice(0, at)).toContain(`/Length ${JPEG.length} >>\nstream\n`);
  });

  it("sets the MediaBox to the page size", () => {
    expect(text).toContain("/MediaBox [0 0 612 792]");
  });

  it("sets the image Width and Height from the JPEG pixel size", () => {
    expect(text).toContain("/Width 800 /Height 600");
    expect(text).toContain("/Filter /DCTDecode");
  });

  it("rounds page sizes to two decimals without exponents", () => {
    const small = asText(jpegToPdf(JPEG, IMAGE, { width: 595.276, height: 0.0001 }));
    expect(small).toContain("/MediaBox [0 0 595.28 0]");
    expect(small).toContain("q 595.28 0 0 0 0 0 cm /Im0 Do Q");
  });
});

describe("pointsFromPixels", () => {
  it("converts 96 px per inch to 72 points per inch", () => {
    expect(pointsFromPixels(96)).toBe(72);
    expect(pointsFromPixels(1920)).toBe(1440);
  });
});
