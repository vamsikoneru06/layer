import type { S3Client } from "@aws-sdk/client-s3";
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

  it("doesn't sign a checksum into upload URLs (S3 and R2 would reject every real body)", async () => {
    const url = new URL(await s3Storage(config).presignUpload("private", "staging/u/a", { contentType: "image/png", contentLength: 10, expiresInSeconds: 300 }));
    const checksumParams = [...url.searchParams.keys()].filter((k) => /checksum/i.test(k));
    expect(checksumParams).toEqual([]);
  });

  it("presigns downloads from the requested bucket", async () => {
    const url = new URL(await s3Storage(config).presignDownload("private", "u/user-1/asset-1", 3600));
    expect(url.pathname).toBe("/storage/v1/s3/vash-private/u/user-1/asset-1");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
  });

  it("copies within or across buckets, URL-encoding the source", async () => {
    const sent: { input: unknown }[] = [];
    const client = { send: async (cmd: { input: unknown }) => void sent.push(cmd) } as unknown as S3Client;
    await s3Storage(config, client).copy({ bucket: "private", key: "u/user 1/a" }, { bucket: "public", key: "t/tpl/a" });
    expect(sent.map((c) => c.input)).toEqual([{ Bucket: "vash-public", Key: "t/tpl/a", CopySource: "vash-private/u/user%201/a" }]);
  });

  it("builds public URLs under the public base, encoding each key segment", () => {
    expect(s3Storage(config).publicUrl("t/tpl 1/a#b")).toBe("https://proj.supabase.co/storage/v1/object/public/vash-public/t/tpl%201/a%23b");
  });
});
