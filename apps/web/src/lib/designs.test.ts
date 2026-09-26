import { describe, expect, it } from "vitest";
import { editedLabel, firstName, fitBox, formatLabel, greeting, sortDesigns } from "./designs";

const now = new Date("2026-09-25T18:30:00");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("editedLabel", () => {
  it("counts minutes and hours for today", () => {
    expect(editedLabel(ago(20_000), now)).toBe("Edited just now");
    expect(editedLabel(ago(12 * MIN), now)).toBe("Edited 12 min ago");
    expect(editedLabel(ago(2 * HOUR), now)).toBe("Edited 2 h ago");
  });
  it("uses yesterday, then a weekday, then a date", () => {
    expect(editedLabel(new Date("2026-09-24T09:00:00").toISOString(), now)).toBe("Edited yesterday");
    expect(editedLabel(new Date("2026-09-21T09:00:00").toISOString(), now)).toBe("Edited Mon");
    expect(editedLabel(ago(10 * DAY), now)).toBe("Edited Sep 15");
    expect(editedLabel(new Date("2025-12-01T09:00:00").toISOString(), now)).toBe("Edited Dec 1, 2025");
  });
});

describe("greeting", () => {
  it.each([
    [6, "Good morning"],
    [13, "Good afternoon"],
    [19, "Good evening"],
    [2, "Good evening"],
  ])("at %i:00 says %s", (hour, text) => {
    const d = new Date(now);
    d.setHours(hour);
    expect(greeting(d)).toBe(text);
  });
});

describe("helpers", () => {
  it("labels formats the way cards show them", () => {
    expect(formatLabel("ig-post")).toBe("Post");
    expect(formatLabel("yt-thumbnail")).toBe("Thumbnail");
    expect(formatLabel("something-new")).toBe("Custom");
  });
  it("takes the first name, or nothing", () => {
    expect(firstName("Riya Sharma")).toBe("Riya");
    expect(firstName("  ")).toBeNull();
    expect(firstName(null)).toBeNull();
  });
  it("fits an artboard inside a box keeping its ratio", () => {
    expect(fitBox(1080, 1920, 140, 160)).toEqual({ width: 90, height: 160 });
    expect(fitBox(1280, 720, 190, 160)).toEqual({ width: 190, height: 107 });
  });
  it("sorts by name, creation or last edit", () => {
    const items = [
      { title: "b", createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-05T00:00:00Z" },
      { title: "A", createdAt: "2026-01-03T00:00:00Z", updatedAt: "2026-01-04T00:00:00Z" },
    ];
    expect(sortDesigns(items, "name").map((d) => d.title)).toEqual(["A", "b"]);
    expect(sortDesigns(items, "created").map((d) => d.title)).toEqual(["A", "b"]);
    expect(sortDesigns(items, "edited").map((d) => d.title)).toEqual(["b", "A"]);
  });
});
