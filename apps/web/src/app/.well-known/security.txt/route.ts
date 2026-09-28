/**
 * RFC 9116: tells security researchers where to report vulnerabilities. Served only once
 * CONTACT_EMAIL is set; "Expires" rolls forward a year from each request.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  const email = process.env.CONTACT_EMAIL;
  if (!email) return new Response("Not found", { status: 404 });
  const origin = process.env.APP_ORIGIN ?? "";
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const body = [`Contact: mailto:${email}`, `Expires: ${expires}`, `Policy: ${origin}/terms`, "Preferred-Languages: en", ""].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
