/**
 * SVG path-data validator. Accepts only the path grammar (commands + numbers),
 * so a path string can never smuggle markup, URLs, or script into a document.
 */

const ARG_COUNTS: Record<string, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

export type PathCheck = { ok: true } | { ok: false; error: string };

export function validatePathData(d: string, maxChars: number): PathCheck {
  if (d.length === 0) return { ok: false, error: "path is empty" };
  if (d.length > maxChars) return { ok: false, error: `path longer than ${maxChars} characters` };

  let i = 0;
  let command: string | null = null;
  let args: number[] = [];
  let sawMoveTo = false;

  const flush = (): string | null => {
    if (command === null) return null;
    const upper = command.toUpperCase();
    const need = ARG_COUNTS[upper]!;
    if (need === 0) {
      return args.length === 0 ? null : `'${command}' takes no arguments`;
    }
    if (args.length === 0 || args.length % need !== 0) {
      return `'${command}' expects a multiple of ${need} numbers, got ${args.length}`;
    }
    if (upper === "A") {
      for (let k = 0; k < args.length; k += 7) {
        if (args[k + 3] !== 0 && args[k + 3] !== 1) return "arc large-arc flag must be 0 or 1";
        if (args[k + 4] !== 0 && args[k + 4] !== 1) return "arc sweep flag must be 0 or 1";
      }
    }
    return null;
  };

  while (i < d.length) {
    const ch = d[i]!;
    if (ch === " " || ch === "," || ch === "\n" || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }
    const upper = ch.toUpperCase();
    if (upper in ARG_COUNTS) {
      const err = flush();
      if (err) return { ok: false, error: err };
      if (!sawMoveTo && upper !== "M") return { ok: false, error: "path must start with a moveto" };
      sawMoveTo = true;
      command = ch;
      args = [];
      i++;
      continue;
    }
    const match = NUMBER.exec(d.slice(i, i + 64));
    if (!match) return { ok: false, error: `unexpected character '${ch}' at ${i}` };
    if (command === null) return { ok: false, error: "number before any command" };
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return { ok: false, error: `invalid number at ${i}` };
    args.push(value);
    i += match[0].length;
  }

  const err = flush();
  if (err) return { ok: false, error: err };
  if (!sawMoveTo) return { ok: false, error: "path has no commands" };
  return { ok: true };
}
