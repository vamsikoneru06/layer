import { createEmptyDoc } from "@vash/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LocalDesignsModule from "@/lib/local-designs";
import { localDesigns } from "@/lib/local-designs";
import type { SetMember } from "@/lib/make-set";
import { saveSetLocally } from "./local-designs-grid";

vi.mock("@/lib/local-designs", async (orig) => ({
  ...(await orig<typeof LocalDesignsModule>()),
  localDesigns: { put: vi.fn(), list: vi.fn(), get: vi.fn(), delete: vi.fn() },
}));

const put = vi.mocked(localDesigns.put);

const member = (format: SetMember["format"], title: string): SetMember => ({
  format,
  warnings: [],
  doc: createEmptyDoc({ id: crypto.randomUUID(), kind: "design", title, format }),
});

describe("saveSetLocally", () => {
  beforeEach(() => {
    put.mockReset();
  });

  it("saves every size and reports no failures when every put resolves", async () => {
    put.mockResolvedValue(undefined);
    const members = [member("ig-story", "Trip · Instagram story"), member("yt-thumbnail", "Trip · YouTube thumbnail"), member("poster", "Trip · Poster")];

    const result = await saveSetLocally(members);

    expect(result.saved.map((d) => d.id)).toEqual(members.map((m) => m.doc.id));
    expect(result.failed).toEqual([]);
    expect(put).toHaveBeenCalledTimes(3);
  });

  it("keeps the sizes that saved and names only the format that failed", async () => {
    put.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("quota exceeded")).mockResolvedValueOnce(undefined);
    const members = [member("ig-story", "Trip · Instagram story"), member("yt-thumbnail", "Trip · YouTube thumbnail"), member("poster", "Trip · Poster")];

    const result = await saveSetLocally(members);

    expect(result.saved.map((d) => d.id)).toEqual([members[0]!.doc.id, members[2]!.doc.id]);
    expect(result.failed).toEqual(["yt-thumbnail"]);
  });
});
