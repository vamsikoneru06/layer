import { scrubUrl } from "./monitoring/scrub";

/** Shared by the /report-a-bug form and the API that stores it. */
export const BUG_REPORT_LIMITS = { summaryChars: 2000, expectedChars: 1000, stepsChars: 2000, pageChars: 300, userAgentChars: 300 } as const;

/** The page a report is about: a same-site path with no query string, fragment or share token; anything else is dropped. */
export function reportPage(from: string | null | undefined): string {
  if (!from || !from.startsWith("/") || from.startsWith("//")) return "";
  return scrubUrl(from).slice(0, BUG_REPORT_LIMITS.pageChars);
}
