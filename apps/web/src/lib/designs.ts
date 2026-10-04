/** Display helpers for design lists; pure so they run under the node test environment. */

const FORMAT_LABELS: Record<string, string> = {
  "ig-post": "Post",
  "ig-story": "Story",
  "yt-thumbnail": "Thumbnail",
  poster: "Poster",
  invitation: "Invitation",
};

export function formatLabel(format: string): string {
  return FORMAT_LABELS[format] ?? "Custom";
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function editedLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const ms = now.getTime() - then.getTime();
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days <= 0) {
    if (ms < 60_000) return "Edited just now";
    if (ms < 3_600_000) return `Edited ${Math.floor(ms / 60_000)} min ago`;
    return `Edited ${Math.floor(ms / 3_600_000)} h ago`;
  }
  if (days === 1) return "Edited yesterday";
  if (days < 7) return `Edited ${then.toLocaleDateString("en-US", { weekday: "short" })}`;
  const sameYear = then.getFullYear() === now.getFullYear();
  return `Edited ${then.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })}`;
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  return "Good evening";
}

export function firstName(name: string | null | undefined): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}

export function fitBox(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export type SortKey = "edited" | "name" | "created";

export function sortDesigns<T extends { title: string; createdAt: string; updatedAt: string }>(items: readonly T[], key: SortKey): T[] {
  const copy = [...items];
  if (key === "name") return copy.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  const field = key === "created" ? "createdAt" : "updatedAt";
  return copy.sort((a, b) => b[field].localeCompare(a[field]));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Drag data can come from any page; accept only a bounded list of design ids and ignore anything else. */
export function parseDraggedIds(raw: string, max = 500): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value) && value.length <= max && value.every((v) => typeof v === "string" && UUID.test(v))) return value as string[];
  } catch {
    // not ours
  }
  return [];
}
