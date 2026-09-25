import { describe, expect, it } from "vitest";
import { HttpError } from "./problem";
import { isUuid, parseId } from "./ids";

describe("ids", () => {
  it("accepts UUIDs and normalises case", () => {
    expect(isUuid("8F14E45F-CEEA-467A-9575-3A6B1C7E3B2D")).toBe(true);
    expect(parseId("8F14E45F-CEEA-467A-9575-3A6B1C7E3B2D")).toBe("8f14e45f-ceea-467a-9575-3a6b1c7e3b2d");
  });
  it.each(["abc", "1'", "", undefined, "8f14e45f-ceea-467a-9575-3a6b1c7e3b2d-x"])("treats %s as not found", (v) => {
    expect(() => parseId(v)).toThrow(HttpError);
    try {
      parseId(v);
    } catch (e) {
      expect((e as HttpError).status).toBe(404);
    }
  });
});
