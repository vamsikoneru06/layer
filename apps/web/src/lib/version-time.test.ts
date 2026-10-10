import { describe, expect, it } from "vitest";
import { versionTimeLabel } from "./version-time";

// Local calendar dates, so the labels do not depend on the machine's time zone.
const now = new Date(2026, 9, 10, 15, 0); // Saturday 10 Oct 2026, 15:00
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).toISOString();

describe("versionTimeLabel", () => {
  it("says Today with the 24-hour time for a version from earlier today", () => {
    expect(versionTimeLabel(at(2026, 9, 10, 14, 5), now, "en-GB")).toBe("Today, 14:05");
    expect(versionTimeLabel(at(2026, 9, 10, 0, 5), now, "en-GB")).toBe("Today, 00:05");
  });

  it("says Yesterday for the previous calendar day, even late at night", () => {
    expect(versionTimeLabel(at(2026, 9, 9, 9, 12), now, "en-GB")).toBe("Yesterday, 09:12");
    expect(versionTimeLabel(at(2026, 9, 9, 23, 59), now, "en-GB")).toBe("Yesterday, 23:59");
  });

  it("shows day and month for older versions in the current year", () => {
    expect(versionTimeLabel(at(2026, 9, 3, 18, 40), now, "en-GB")).toBe("3 Oct, 18:40");
    expect(versionTimeLabel(at(2026, 0, 20, 7, 30), now, "en-GB")).toBe("20 Jan, 07:30");
  });

  it("adds the year for versions from an earlier year", () => {
    expect(versionTimeLabel(at(2025, 9, 3, 18, 40), now, "en-GB")).toBe("3 Oct 2025, 18:40");
  });

  it("compares calendar days, so a version from 23:59 yesterday is not Today", () => {
    const justAfterMidnight = new Date(2026, 9, 10, 0, 1);
    expect(versionTimeLabel(at(2026, 9, 9, 23, 59), justAfterMidnight, "en-GB")).toBe("Yesterday, 23:59");
  });
});
