import type { z } from "zod";
import { badRequest, HttpError } from "./problem";

export const DEFAULT_BODY_LIMIT = 64 * 1024;

const tooLarge = (max: number) => new HttpError(413, "Content Too Large", `The request body must be at most ${max} bytes.`);

export async function readJson<S extends z.ZodType>(req: Request, schema: S, maxBytes = DEFAULT_BODY_LIMIT): Promise<z.output<S>> {
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) {
    throw new HttpError(415, "Unsupported Media Type", "Send the request body as application/json.");
  }
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes);
  const text = await readText(req, maxBytes);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw badRequest("The request body is not valid JSON.");
  }
  return parseWith(schema, data, "body");
}

export function readQuery<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  return parseWith(schema, Object.fromEntries(new URL(req.url).searchParams), "query");
}

function parseWith<S extends z.ZodType>(schema: S, data: unknown, where: "body" | "query"): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(`The request ${where} is invalid.`, {
      issues: result.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    });
  }
  return result.data;
}

async function readText(req: Request, maxBytes: number): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw badRequest("The request body is not valid UTF-8.");
  }
}
