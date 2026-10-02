import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver, type SaveStatus } from "./autosave";

type Saved = { doc: string; version: number };

function setup(save: (doc: string, version: number) => Promise<number>) {
  const statuses: SaveStatus[] = [];
  const saver = createAutosaver<string>({ version: 1, delayMs: 1500, retryMs: 5000, save, onStatus: (s) => statuses.push(s) });
  return { saver, statuses };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("autosaver", () => {
  it("debounces edits and saves only the latest document with the current version", async () => {
    const calls: Saved[] = [];
    const { saver, statuses } = setup(async (doc, version) => (calls.push({ doc, version }), version + 1));
    saver.change("a");
    await vi.advanceTimersByTimeAsync(1000);
    saver.change("b");
    await vi.advanceTimersByTimeAsync(1499);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([{ doc: "b", version: 1 }]);
    expect(statuses).toEqual(["unsaved", "saving", "saved"]);
    saver.change("c");
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls.at(-1)).toEqual({ doc: "c", version: 2 });
    expect(saver.dirty).toBe(false);
  });

  it("saves again after the in-flight save if the document changed meanwhile", async () => {
    let release!: () => void;
    const calls: Saved[] = [];
    const { saver } = setup(
      (doc, version) =>
        new Promise((resolve) => {
          calls.push({ doc, version });
          release = () => resolve(version + 1);
        }),
    );
    saver.change("a");
    await vi.advanceTimersByTimeAsync(1500);
    saver.change("b");
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toHaveLength(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([
      { doc: "a", version: 1 },
      { doc: "b", version: 2 },
    ]);
  });

  it("stops on a version conflict and reports it", async () => {
    const { saver, statuses } = setup(async () => {
      throw Object.assign(new Error("changed"), { status: 409 });
    });
    saver.change("a");
    await vi.advanceTimersByTimeAsync(1500);
    expect(statuses.at(-1)).toBe("conflict");
    saver.change("b");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(statuses.at(-1)).toBe("conflict");
    expect(saver.dirty).toBe(true);
  });

  it("goes offline on network failure and retries until it succeeds", async () => {
    let fail = true;
    const { saver, statuses } = setup(async (_d, v) => {
      if (fail) throw Object.assign(new Error("net"), { status: 0 });
      return v + 1;
    });
    saver.change("a");
    await vi.advanceTimersByTimeAsync(1500);
    expect(statuses.at(-1)).toBe("offline");
    fail = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("reports failures a retry won't fix by itself as errors that a manual retry clears", async () => {
    let fail = true;
    const { saver, statuses } = setup(async (_d, v) => {
      if (fail) throw Object.assign(new Error("too big"), { status: 413 });
      return v + 1;
    });
    saver.change("a");
    await vi.advanceTimersByTimeAsync(1500);
    expect(statuses.at(-1)).toBe("error");
    fail = false;
    await saver.flush();
    expect(statuses.at(-1)).toBe("saved");
  });

  it("retries a busy or failing server with backoff until it succeeds", async () => {
    let failures = 2;
    const attempts: number[] = [];
    const { saver, statuses } = setup(async (_d, v) => {
      attempts.push(Date.now());
      if (failures-- > 0) throw Object.assign(new Error("busy"), { status: failures === 1 ? 429 : 503 });
      return v + 1;
    });
    saver.change("a");
    await vi.advanceTimersByTimeAsync(1500);
    expect(statuses.at(-1)).toBe("retrying");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(statuses.at(-1)).toBe("saved");
    expect(attempts).toHaveLength(3);
    // The second wait is twice the first.
    expect(attempts[2]! - attempts[1]!).toBe(2 * (attempts[1]! - attempts[0]!));
  });

  it("waits for sign-in when the session has ended, keeping the change", async () => {
    let signedIn = false;
    const { saver, statuses } = setup(async (_d, v) => {
      if (!signedIn) throw Object.assign(new Error("signed out"), { status: 401 });
      return v + 1;
    });
    saver.change("a");
    await vi.advanceTimersByTimeAsync(1500);
    expect(statuses.at(-1)).toBe("signed-out");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(statuses.at(-1)).toBe("signed-out");
    expect(saver.dirty).toBe(true);
    signedIn = true;
    await saver.flush();
    expect(statuses.at(-1)).toBe("saved");
  });

  it("can be rebased after a reload, clearing the conflict", async () => {
    const calls: Saved[] = [];
    const { saver, statuses } = setup(async (doc, version) => {
      if (version === 1) throw Object.assign(new Error("changed"), { status: 409 });
      calls.push({ doc, version });
      return version + 1;
    });
    saver.change("a");
    await vi.advanceTimersByTimeAsync(1500);
    saver.reset(7);
    expect(statuses.at(-1)).toBe("saved");
    saver.change("b");
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual([{ doc: "b", version: 7 }]);
  });
});
