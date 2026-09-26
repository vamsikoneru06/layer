import "server-only";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, NotFound, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageConfig } from "../config";
import type { Bucket, ObjectStorage } from "./types";

const isNotFound = (err: unknown) =>
  err instanceof NotFound || (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404);

/** Supabase Storage (or any S3-compatible store) over the S3 protocol, path-style. */
export function s3Storage(
  config: StorageConfig,
  client: S3Client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Default "WHEN_SUPPORTED" signs a CRC32 of the (empty) presign-time body into upload URLs,
    // which S3/R2 then reject for every real upload; ranged reads can't be validated either.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  }),
): ObjectStorage {
  const bucketName = (bucket: Bucket) => (bucket === "public" ? config.publicBucket : config.privateBucket);
  return {
    presignUpload: (bucket, key, o) =>
      getSignedUrl(client, new PutObjectCommand({ Bucket: bucketName(bucket), Key: key, ContentType: o.contentType, ContentLength: o.contentLength }), {
        expiresIn: o.expiresInSeconds,
        // Signed, so the browser can't PUT a different type or size with this URL.
        signableHeaders: new Set(["content-type", "content-length"]),
      }),
    presignDownload: (bucket, key, expiresInSeconds) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket: bucketName(bucket), Key: key }), { expiresIn: expiresInSeconds }),
    publicUrl: (key) => `${config.publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`,
    async head(bucket, key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: bucketName(bucket), Key: key }));
        return { contentLength: res.ContentLength ?? 0 };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async readPrefix(bucket, key, length) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucketName(bucket), Key: key, Range: `bytes=0-${length - 1}` }));
      return (await res.Body?.transformToByteArray()) ?? new Uint8Array();
    },
    async remove(bucket, key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucketName(bucket), Key: key }));
    },
  };
}
