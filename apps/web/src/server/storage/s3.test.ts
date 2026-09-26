import { describe, expect, it } from "vitest";
import { s3Storage } from "./s3";

const config = {
  endpoint: "https://proj.storage.supabase.co/storage/v1/s3",
  region: "ap-south-1",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  privateBucket: "vash-private",
  publicBucket: "vash-public",
  publicBaseUrl: "https://proj.supabase.co/storage/v1/object/public/vash-public",
};

describe("s3Storage", () => {
  it("presigns a PUT bound to the declared type and length, valid for the given seconds", async () => {
    const url = new URL(await s3Storage(config).presignUpload("private", "u/user-1/asset-1", { contentType: "image/png", contentLength: 1234, expiresInSeconds: 300 }));
    expect(url.origin).toBe("https://proj.storage.supabase.co");
    expect(url.pathname).toBe("/storage/v1/s3/vash-private/u/user-1/asset-1");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(expect.arrayContaining(["content-length", "content-type", "host"]));
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("presigns downloads from the requested bucket", async () => {
    const url = new URL(await s3Storage(config).presignDownload("private", "u/user-1/asset-1", 3600));
    expect(url.pathname).toBe("/storage/v1/s3/vash-private/u/user-1/asset-1");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
  });

  it("builds public URLs under the public base, encoding each key segment", () => {
    expect(s3Storage(config).publicUrl("t/tpl 1/a#b")).toBe("https://proj.supabase.co/storage/v1/object/public/vash-public/t/tpl%201/a%23b");
  });
});
