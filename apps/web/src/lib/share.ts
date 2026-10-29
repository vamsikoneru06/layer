import { request } from "./api";

export type ShareLink = { id: string; createdAt: string };

const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** Midnight at the start of the local calendar day containing `d`. */
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Creates a view-only link for the design. The address is returned once here; the server does not
 * list it again, so the dialog has to show it straight away.
 */
export async function createShareLink(designId: string): Promise<{ id: string; url: string; createdAt: string }> {
  const link = await request<{ id: string; token: string; url: string; createdAt: string }>(`/api/designs/${designId}/share`, { method: "POST" });
  return { id: link.id, url: link.url, createdAt: link.createdAt };
}

/** The design's active links (revoked ones are not listed). The list has no addresses, only ids and dates. */
export async function listShareLinks(designId: string): Promise<ShareLink[]> {
  return (await request<{ items: ShareLink[] }>(`/api/designs/${designId}/share`)).items;
}

/** Stops the link from working for everyone who has it. */
export const revokeShareLink = (designId: string, linkId: string) => request<void>(`/api/designs/${designId}/share/${linkId}`, { method: "DELETE" });

/**
 * "Created today at 14:05", "Created yesterday at 09:12", "Created 3 Oct at 18:40", with the year added
 * for links from an earlier year. Days are local calendar days and the clock is 24-hour.
 */
export function shareLinkLabel(createdAt: string, now: Date): string {
  const at = new Date(createdAt);
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days === 0) return `Created today at ${time}`;
  if (days === 1) return `Created yesterday at ${time}`;
  const date = at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `Created ${date} at ${time}`;
}
