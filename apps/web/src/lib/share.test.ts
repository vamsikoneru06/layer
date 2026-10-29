import { describe, expect, it } from "vitest";
import { shareLinkLabel } from "./share";

// Local calendar dates, so the labels do not depend on the machine's time zone.
const now = new Date(2026, 9, 10, 15, 0); // Saturday 10 Oct 2026, 15:00
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).toISOString();

describe("shareLinkLabel", () => {
  it("says created today with the 24-hour time for a link made earlier today", () => {
    expect(shareLinkLabel(at(2026, 9, 10, 14, 5), now)).toBe("Created today at 14:05");
    expect(shareLinkLabel(at(2026, 9, 10, 0, 5), now)).toBe("Created today at 00:05");
  });

  it("says yesterday for the previous calendar day, even late at night", () => {
    expect(shareLinkLabel(at(2026, 9, 9, 9, 12), now)).toBe("Created yesterday at 09:12");
    expect(shareLinkLabel(at(2026, 9, 9, 23, 59), now)).toBe("Created yesterday at 23:59");
  });

  it("shows day and month for older links in the current year", () => {
    expect(shareLinkLabel(at(2026, 9, 3, 18, 40), now)).toBe("Created 3 Oct at 18:40");
    expect(shareLinkLabel(at(2026, 0, 20, 7, 30), now)).toBe("Created 20 Jan at 07:30");
  });

  it("adds the year for links from an earlier year", () => {
    expect(shareLinkLabel(at(2025, 9, 3, 18, 40), now)).toBe("Created 3 Oct 2025 at 18:40");
  });

  it("compares calendar days, so a link from 23:59 yesterday is not today", () => {
    const justAfterMidnight = new Date(2026, 9, 10, 0, 1);
    expect(shareLinkLabel(at(2026, 9, 9, 23, 59), justAfterMidnight)).toBe("Created yesterday at 23:59");
  });
});
