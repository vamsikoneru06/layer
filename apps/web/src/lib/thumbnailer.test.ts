import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThumbnailer } from "./thumbnailer";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createThumbnailer", () => {
  it("waits for editing to pause, then makes one preview of the latest save", async () => {
    const make = vi.fn(async () => {});
    const t = createThumbnailer({ delayMs: 1000, make });
    t.saved("a");
    await vi.advanceTimersByTimeAsync(500);
    t.saved("b");
    await vi.advanceTimersByTimeAsync(999);
    expect(make).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(make).toHaveBeenCalledTimes(1);
    expect(make).toHaveBeenCalledWith("b");
  });

  it("skips a save that didn't change anything", async () => {
    const make = vi.fn(async () => {});
    const t = createThumbnailer({ delayMs: 10, make });
    t.saved("a");
    await vi.advanceTimersByTimeAsync(10);
    t.saved("a");
    await vi.advanceTimersByTimeAsync(10);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("tries again after a failure, and catches up with saves made while one was running", async () => {
    let fail = true;
    let release!: () => void;
    const make = vi.fn(async (doc: string) => {
      if (fail) {
        fail = false;
        throw new Error("offline");
      }
      if (doc === "b") await new Promise<void>((r) => (release = r));
    });
    const t = createThumbnailer({ delayMs: 10, make });
    t.saved("a");
    await vi.advanceTimersByTimeAsync(10);
    t.saved("b");
    await vi.advanceTimersByTimeAsync(10);
    t.saved("c");
    await vi.advanceTimersByTimeAsync(10);
    release();
    await vi.advanceTimersByTimeAsync(20);
    expect(make.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c"]);
  });
});
