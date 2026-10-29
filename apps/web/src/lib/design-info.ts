import type { Doc } from "@vash/schema";
import { formatLabel } from "./designs";

/** The facts the Design info dialog shows. Only things the app really knows. */
export function describeDesign(doc: Doc, savedAt: string, locale?: string): { label: string; value: string }[] {
  const saved = new Date(savedAt);
  return [
    { label: "Size", value: `${doc.artboard.width} × ${doc.artboard.height} px` },
    { label: "Format", value: formatLabel(doc.meta.format) },
    { label: "Layers", value: String(Object.keys(doc.nodes).length) },
    { label: "Last saved", value: Number.isNaN(saved.getTime()) ? "Not saved yet" : saved.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) },
  ];
}
