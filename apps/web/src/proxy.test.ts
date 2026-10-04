import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy, storageOrigins } from "./proxy";

describe("proxy", () => {
  it("adds a fresh CSP nonce and the security headers to every response", () => {
    const a = proxy(new NextRequest("http://localhost:3000/templates"));
    const b = proxy(new NextRequest("http://localhost:3000/templates"));
    const nonceA = /'nonce-([^']+)'/.exec(a.headers.get("content-security-policy") ?? "")?.[1];
    const nonceB = /'nonce-([^']+)'/.exec(b.headers.get("content-security-policy") ?? "")?.[1];
    expect(nonceA).toBeTruthy();
    expect(nonceA).not.toBe(nonceB);
    expect(a.headers.get("x-frame-options")).toBe("DENY");
    expect(a.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("storageOrigins", () => {
  it("derives unique https origins from the storage settings and ignores junk", () => {
    expect(
      storageOrigins({
        STORAGE_ENDPOINT: "https://proj.storage.supabase.co/storage/v1/s3",
        STORAGE_PUBLIC_BASE_URL: "https://proj.supabase.co/storage/v1/object/public/vash-public",
      }),
    ).toEqual(["https://proj.storage.supabase.co", "https://proj.supabase.co"]);
    expect(storageOrigins({ STORAGE_ENDPOINT: "not a url", STORAGE_PUBLIC_BASE_URL: "" })).toEqual([]);
    expect(storageOrigins({ STORAGE_ENDPOINT: "javascript:alert(1)" })).toEqual([]);
    expect(storageOrigins({ STORAGE_ENDPOINT: "http://insecure.example" })).toEqual([]);
  });
});
