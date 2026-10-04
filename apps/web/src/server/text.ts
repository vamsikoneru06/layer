/** True when the string has an unpaired UTF-16 surrogate, which Postgres can't store in text or jsonb. */
export const hasLoneSurrogate = (s: string): boolean => /\p{Surrogate}/u.test(s);

/** Cuts to at most `max` UTF-16 units without splitting a surrogate pair (an emoji cut in half is invalid JSON for jsonb). */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
}
