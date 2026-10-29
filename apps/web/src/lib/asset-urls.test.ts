import { describe, expect, it, vi } from "vitest";
import { createAssetUrls } from "./asset-urls";

const answer = (ids: string[], expiresAt: string | null = null) => ({ assets: ids.filter((id) => id !== "gone").map((id) => ({ id, url: `/u/${id}`, expiresAt })) });

describe("createAssetUrls", () => {
  it("resolves ids asked for together in one request and caches them", async () => {
    const resolve = vi.fn(async (ids: string[]) => answer(ids));
    const urls = createAssetUrls(resolve);
    expect(await Promise.all([urls.get("a"), urls.get("b"), urls.get("a"), urls.get("gone")])).toEqual(["/u/a", "/u/b", "/u/a", null]);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0]![0].sort()).toEqual(["a", "b", "gone"]);
    expect(await urls.get("a")).toBe("/u/a");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("asks again before a signed URL expires", async () => {
    let t = 0;
    const resolve = vi.fn(async (ids: string[]) => answer(ids, new Date(t + 10 * 60_000).toISOString()));
    const urls = createAssetUrls(resolve, () => t);
    await urls.get("a");
    t = 8 * 60_000;
    expect(urls.peek("a")).toBe("/u/a");
    t = 9.5 * 60_000;
    expect(urls.peek("a")).toBeUndefined();
    await urls.get("a");
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("shows nothing when the request fails, then tries again", async () => {
    const resolve = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(async (ids: string[]) => answer(ids));
    const urls = createAssetUrls(resolve);
    expect(await urls.get("a")).toBeNull();
    expect(await urls.get("a")).toBe("/u/a");
  });

  it("asks again after forget, so a URL that stopped working can be replaced", async () => {
    const resolve = vi.fn(async (ids: string[]) => answer(ids));
    const urls = createAssetUrls(resolve);
    expect(await urls.get("a")).toBe("/u/a");
    expect(urls.peek("a")).toBe("/u/a");
    urls.forget("a");
    expect(urls.peek("a")).toBeUndefined();
    expect(await urls.get("a")).toBe("/u/a");
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
