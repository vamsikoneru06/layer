import { resizeDoc, type ResizeWarning } from "@vash/engine";
import { FORMATS, LIMITS, type Doc, type FormatKey } from "@vash/schema";

/** The sizes a design can be made into: every standard size except its own. */
export function otherSizes(doc: Doc): { format: FormatKey; label: string; width: number; height: number }[] {
  return (Object.entries(FORMATS) as [Exclude<FormatKey, "custom">, (typeof FORMATS)[keyof typeof FORMATS]][])
    .filter(([format, f]) => format !== doc.meta.format && !(f.width === doc.artboard.width && f.height === doc.artboard.height))
    .map(([format, f]) => ({ format, label: f.label, width: f.width, height: f.height }));
}

export interface SetMember {
  format: FormatKey;
  doc: Doc;
  /** Text layers that end up too small to read; the person should check them. */
  warnings: ResizeWarning[];
}

/** "Make the set": the design at each chosen size, as new documents titled "<title> · <size>". */
export function planSet(doc: Doc, formats: readonly FormatKey[]): SetMember[] {
  return otherSizes(doc)
    .filter((s) => formats.includes(s.format))
    .map((s) => {
      const { doc: resized, warnings } = resizeDoc(doc, s);
      const suffix = ` · ${s.label}`;
      const title = `${doc.meta.title.slice(0, LIMITS.titleChars - suffix.length)}${suffix}`;
      return { format: s.format, warnings, doc: { ...resized, id: crypto.randomUUID(), kind: "design", meta: { ...resized.meta, title } } };
    });
}
