export type ExportFormat = "png" | "jpg" | "pdf";

/** "Riya's Birthday!" at 2× → "riyas-birthday@2x.png"; an empty slug falls back to "design". */
export function exportFileName(title: string, scale: number, format: ExportFormat = "png"): string {
  const slug =
    title
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "design";
  return `${slug}${scale > 1 ? `@${scale}x` : ""}.${format}`;
}
