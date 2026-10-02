import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readJson, readQuery } from "./body";

const Schema = z.object({ name: z.string() }).strict();
const post = (body: BodyInit, type = "application/json") =>
  new Request("http://localhost/", { method: "POST", headers: { "content-type": type }, body });

async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

describe("readJson", () => {
  it("parses a valid body", async () => {
    expect(await readJson(post('{"name":"x"}'), Schema)).toEqual({ name: "x" });
  });
  it("rejects the wrong content type with 415", async () => {
    expect(await statusOf(readJson(post('{"name":"x"}', "text/plain"), Schema))).toBe(415);
  });
  it("rejects bodies over the limit with 413, even without Content-Length", async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(`{"name":"${"x".repeat(100)}"}`));
        c.close();
      },
    });
    const req = new Request("http://localhost/", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    expect(await statusOf(readJson(req, Schema, 32))).toBe(413);
  });
  it("rejects invalid JSON, invalid UTF-8, arrays and unknown keys with 400", async () => {
    expect(await statusOf(readJson(post("{nope"), Schema))).toBe(400);
    expect(await statusOf(readJson(post(new Uint8Array([0x7b, 0xff, 0x7d])), Schema))).toBe(400);
    expect(await statusOf(readJson(post("[]"), Schema))).toBe(400);
    expect(await statusOf(readJson(post('{"name":"x","role":"admin"}'), Schema))).toBe(400);
  });
});

describe("NUL characters", () => {
  it("rejects a NUL anywhere in a JSON body, keys included, with 400", async () => {
    const Loose = z.object({ name: z.string(), tags: z.array(z.string()) }).strict();
    expect(await statusOf(readJson(post('{"name":"a\\u0000b","tags":[]}'), Loose))).toBe(400);
    expect(await statusOf(readJson(post('{"name":"a","tags":["x","y\\u0000"]}'), Loose))).toBe(400);
    expect(await statusOf(readJson(post('{"name":"a","tags":[],"k\\u0000":1}'), z.object({}).passthrough()))).toBe(400);
  });

  it("rejects a NUL in a query string with 400", () => {
    expect(() => readQuery(new Request("http://localhost/?name=a%00b"), Schema)).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe("unpaired surrogates", () => {
  it("rejects a string with an unpaired UTF-16 surrogate with 400, and accepts real emoji", async () => {
    expect(await statusOf(readJson(post('{"name":"a\\ud83d"}'), Schema))).toBe(400);
    expect(await statusOf(readJson(post('{"name":"\\udc00b"}'), Schema))).toBe(400);
    expect(await statusOf(readJson(post(JSON.stringify({ name: "party 🎉" })), Schema))).toBe(200);
  });
});
