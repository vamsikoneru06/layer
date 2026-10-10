const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** Midnight at the start of the local calendar day containing `d`. */
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * The time label for a saved version: "Today, 14:05", "Yesterday, 09:12", "3 Oct, 18:40", or
 * "3 Oct 2025, 18:40" when the version is from an earlier year. Days are local calendar days and
 * the clock is 24-hour. `locale` only shapes the month name.
 */
export function versionTimeLabel(iso: string, now: Date, locale = "en-GB"): string {
  const at = new Date(iso);
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const date = at.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${date}, ${time}`;
}
