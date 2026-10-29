import { describe, expect, it } from "vitest";
import { formatFileSize } from "./file-size";

describe("formatFileSize", () => {
  it("keeps sizes under 1 KB in bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("rounds sizes under 1 MB to whole kilobytes", () => {
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(240 * 1024)).toBe("240 KB");
    expect(formatFileSize(1536)).toBe("2 KB");
    expect(formatFileSize(1024 * 1023)).toBe("1023 KB");
  });

  it("shows megabytes with one decimal from 1 MB up", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(1024 * 1024 * 3.44)).toBe("3.4 MB");
  });

  it("moves to megabytes when rounding would reach 1024 KB", () => {
    expect(formatFileSize(1024 * 1024 - 100)).toBe("1.0 MB");
  });
});
