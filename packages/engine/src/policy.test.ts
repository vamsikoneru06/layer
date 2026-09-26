import { describe, expect, it } from "vitest";
import type { Command } from "./commands";
import { checkPolicy } from "./policy";
import { docWith, rect, text } from "./test-docs";

const doc = docWith([
  { ...rect("free", {}), lock: "free" },
  { ...text("contentOnly", {}), lock: "content-only" },
  { ...rect("locked", {}), lock: "locked" },
]);
const move = (id: string): Command => ({ type: "update", id, patch: { transform: { x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1 } } });

describe("checkPolicy in design mode", () => {
  it("lets free layers do anything", () => {
    for (const cmd of [move("free"), { type: "delete", id: "free" } as Command, { type: "reorder", id: "free", index: 2 } as Command]) {
      expect(checkPolicy(doc, cmd, "design").ok).toBe(true);
    }
  });

  it("lets content-only layers change content but not layout, order or existence", () => {
    expect(checkPolicy(doc, { type: "update", id: "contentOnly", patch: { content: "New text" } }, "design").ok).toBe(true);
    expect(checkPolicy(doc, move("contentOnly"), "design").ok).toBe(false);
    expect(checkPolicy(doc, { type: "update", id: "contentOnly", patch: { width: 10 } }, "design").ok).toBe(false);
    expect(checkPolicy(doc, { type: "delete", id: "contentOnly" }, "design").ok).toBe(false);
    expect(checkPolicy(doc, { type: "reorder", id: "contentOnly", index: 0 }, "design").ok).toBe(false);
  });

  it("refuses every change to a locked layer except unlocking it", () => {
    expect(checkPolicy(doc, { type: "update", id: "locked", patch: { opacity: 0.5 } }, "design")).toMatchObject({ ok: false, reason: expect.stringMatching(/locked/i) });
    expect(checkPolicy(doc, { type: "delete", id: "locked" }, "design").ok).toBe(false);
    expect(checkPolicy(doc, { type: "update", id: "locked", patch: { lock: "free" } }, "design").ok).toBe(true);
  });

  it("refuses a whole batch if any part is refused", () => {
    const batch: Command = { type: "batch", commands: [move("free"), move("locked")] };
    expect(checkPolicy(doc, batch, "design").ok).toBe(false);
  });
});

describe("checkPolicy in template mode", () => {
  it("lets the author change locked layers", () => {
    expect(checkPolicy(doc, move("locked"), "template").ok).toBe(true);
    expect(checkPolicy(doc, { type: "delete", id: "contentOnly" }, "template").ok).toBe(true);
  });
});
