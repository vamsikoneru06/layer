import { LIMITS } from "@vash/schema";

export type TitleResult = { ok: true; title: string } | { ok: false; reason: string };

/** Cleans a typed design name and checks it against the schema's limits. */
export function normalizeTitle(input: string): TitleResult {
  const title = input.replace(/\p{Cc}+/gu, " ").trim();
  if (title.length === 0) return { ok: false, reason: "Give your design a name." };
  if (title.length > LIMITS.titleChars) return { ok: false, reason: `Names can be up to ${LIMITS.titleChars} characters.` };
  return { ok: true, title };
}
