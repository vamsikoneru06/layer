import { describe, expect, it } from "vitest";
import { sniffImageMime } from "./sniff";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (s: string) => new TextEncoder().encode(s);

describe("sniffImageMime", () => {
  it("recognises JPEG, PNG and WebP by their magic bytes", () => {
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toBe("image/jpeg");
    expect(sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d))).toBe("image/png");
    expect(sniffImageMime(new Uint8Array([...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBPVP8 ")]))).toBe("image/webp");
  });

  it.each([
    ["SVG", ascii('<svg xmlns="http://www.w3.org/2000/svg">')],
    ["HTML", ascii("<!doctype html><script>")],
    ["GIF", ascii("GIF89a\u0001\u0000")],
    ["WAV (RIFF but not WEBP)", new Uint8Array([...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WAVEfmt ")])],
    ["a truncated PNG header", bytes(0x89, 0x50, 0x4e, 0x47)],
    ["nothing", new Uint8Array()],
  ])("rejects %s", (_name, input) => {
    expect(sniffImageMime(input)).toBeNull();
  });
});
