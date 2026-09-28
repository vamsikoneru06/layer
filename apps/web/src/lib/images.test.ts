import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createImageLoader } from "./images";

const resolveAssets = vi.fn();
vi.mock("./api", () => ({ resolveAssets: (ids: string[]) => resolveAssets(ids) }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["x"]))));
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 10, height: 8, close() {} })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  resolveAssets.mockReset();
});

describe("createImageLoader", () => {
  it("resolves ids asked for together in one request, then decodes and reports each photo", async () => {
    resolveAssets.mockResolvedValue({ assets: [{ id: "a", url: "/a.jpg" }, { id: "b", url: "/b.jpg" }] });
    const onChange = vi.fn();
    const loader = createImageLoader(onChange);
    expect(loader.image("a")).toBe("loading");
    expect(loader.image("b")).toBe("loading");
    await loader.ready(["a", "b"]);
    expect(resolveAssets).toHaveBeenCalledTimes(1);
    expect(resolveAssets).toHaveBeenCalledWith(["a", "b"]);
    expect(loader.image("a")).toMatchObject({ width: 10, height: 8 });
    expect(onChange).toHaveBeenCalled();
  });

  it("marks what it can't find as missing, and ready() tries those once more", async () => {
    resolveAssets.mockResolvedValueOnce({ assets: [] }).mockResolvedValueOnce({ assets: [{ id: "a", url: "/a.jpg" }] });
    const loader = createImageLoader(() => {});
    await loader.ready(["a"]);
    expect(loader.image("a")).toBe("missing");
    await loader.ready(["a"]);
    expect(loader.image("a")).toMatchObject({ width: 10 });
  });

  it("treats a failed lookup as missing rather than loading forever", async () => {
    resolveAssets.mockRejectedValue(new Error("offline"));
    const loader = createImageLoader(() => {});
    await loader.ready(["a"]);
    expect(loader.image("a")).toBe("missing");
  });
});
