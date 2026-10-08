import { describe, expect, it } from "vitest";
import { BUG_REPORT_LIMITS, reportPage } from "./bug-reports";

describe("reportPage", () => {
  it("keeps a same-site path without its query, fragment or share token", () => {
    expect(reportPage("/designs")).toBe("/designs");
    expect(reportPage("/edit/abc?x=1#y")).toBe("/edit/abc");
    expect(reportPage("/s/abc123")).toBe("/s/:token");
  });

  it("drops anything that isn't a same-site path", () => {
    for (const v of [undefined, null, "", "designs", "https://a.test/x", "//a.test/x"]) expect(reportPage(v)).toBe("");
  });

  it("caps the length", () => {
    expect(reportPage(`/${"a".repeat(500)}`)).toHaveLength(BUG_REPORT_LIMITS.pageChars);
  });
});
