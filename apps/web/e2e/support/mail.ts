import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";

const LOG = new URL("../.server.log", import.meta.url);

/** Number of sign-in emails logged so far; pass it to `nextSignInLink` to wait for a newer one. */
export function signInEmailCount(): number {
  return signInLinks().length;
}

/** The sign-in link of the first email logged after `seen` earlier ones (development logs mail instead of sending it). */
export async function nextSignInLink(seen: number): Promise<string> {
  let link: string | undefined;
  await expect.poll(() => (link = signInLinks()[seen]), { message: "a sign-in email in the server log", timeout: 30_000 }).toBeTruthy();
  return link!;
}

function signInLinks(): string[] {
  let text: string;
  try {
    text = readFileSync(LOG, "utf8");
  } catch {
    return [];
  }
  const links: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('"mail.development"')) continue;
    try {
      const body = String(JSON.parse(line.slice(line.indexOf("{"))).body ?? "");
      const url = /https?:\/\/\S+/.exec(body)?.[0];
      if (url) links.push(url);
    } catch {
      // Not one of our JSON log lines.
    }
  }
  return links;
}
