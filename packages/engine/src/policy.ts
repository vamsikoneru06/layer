import type { Doc } from "@vash/schema";
import type { Command } from "./commands";

/** "design": a user's copy, where template locks apply. "template": Author Mode, where the author sets them. */
export type EditMode = "design" | "template";

export type PolicyResult = { ok: true } | { ok: false; reason: string };

const LAYOUT_KEYS = new Set(["transform", "width", "height"]);
const OK: PolicyResult = { ok: true };

/**
 * Locks are guardrails, not security (the server stores whatever the user saves), but the engine
 * enforces them so no UI path can move a locked layer by accident. Unlocking is always allowed.
 */
export function checkPolicy(doc: Doc, cmd: Command, mode: EditMode): PolicyResult {
  if (mode === "template") return OK;
  switch (cmd.type) {
    case "insert":
      return OK;
    case "batch": {
      for (const c of cmd.commands) {
        const r = checkPolicy(doc, c, mode);
        if (!r.ok) return r;
      }
      return OK;
    }
    case "update": {
      const lock = doc.nodes[cmd.id]?.lock ?? "free";
      const keys = Object.keys(cmd.patch);
      if (lock === "free" || (keys.length === 1 && keys[0] === "lock")) return OK;
      if (lock === "locked") return { ok: false, reason: "This layer is locked by the template." };
      return keys.some((k) => LAYOUT_KEYS.has(k)) ? { ok: false, reason: "Layout locked by template — you can still change the text or photo." } : OK;
    }
    case "delete":
    case "reorder": {
      const lock = doc.nodes[cmd.id]?.lock ?? "free";
      return lock === "free" ? OK : { ok: false, reason: "This layer is locked by the template." };
    }
  }
}
