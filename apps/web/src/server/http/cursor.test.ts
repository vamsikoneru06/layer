import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, pageQuery, toPage } from "./cursor";

const id = "8f14e45f-ceea-467a-9575-3a6b1c7e3b2d";

describe("cursor", () => {
  it("round-trips", () => {
    const c = { at: "2026-09-25T10:00:00.123Z", id };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it.each(["garbage", Buffer.from('["not-a-date","x"]').toString("base64url"), Buffer.from("{}").toString("base64url")])(
    "rejects a tampered cursor %s with 400",
    (s) => {
      expect(() => decodeCursor(s)).toThrow(expect.objectContaining({ status: 400 }));
    },
  );
  it("caps limit at 50 and defaults to 20", () => {
    expect(pageQuery.parse({}).limit).toBe(20);
    expect(pageQuery.safeParse({ limit: "51" }).success).toBe(false);
  });
  it("builds a page and a next cursor only when more rows exist", () => {
    const rows = [1, 2, 3].map((n) => ({ n, at: new Date(n * 1000), id }));
    const page = toPage(rows, 2, (r) => ({ at: r.at.toISOString(), id: r.id }), (r) => r.n);
    expect(page.items).toEqual([1, 2]);
    expect(decodeCursor(page.nextCursor!)).toEqual({ at: rows[1]!.at.toISOString(), id });
    expect(toPage(rows.slice(0, 2), 2, (r) => ({ at: r.at.toISOString(), id }), (r) => r.n).nextCursor).toBeNull();
  });
});
