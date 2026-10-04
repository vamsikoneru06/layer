/** A fake 2D context for tests: records every method call and property write, in order. */
export interface Recorded {
  ctx: CanvasRenderingContext2D;
  calls: Array<{ op: string; args: unknown[] }>;
}

export function recordingContext(width = 800, height = 600): Recorded {
  const calls: Recorded["calls"] = [];
  const state: Record<string | symbol, unknown> = { canvas: { width, height } };
  const gradient = { addColorStop: (...args: unknown[]) => calls.push({ op: "addColorStop", args }) };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args: unknown[]) => {
        calls.push({ op: String(key), args });
        return key === "createLinearGradient" ? gradient : undefined;
      };
    },
    set(target, key, value) {
      target[key] = value;
      calls.push({ op: `set:${String(key)}`, args: [value] });
      return true;
    },
    has: () => true,
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}
