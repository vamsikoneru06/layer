export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(detail);
    this.name = "HttpError";
  }
}

export const notFound = () => new HttpError(404, "Not Found", "The requested resource does not exist.");
export const badRequest = (detail: string, extra?: Record<string, unknown>) => new HttpError(400, "Bad Request", detail, extra);
export const unprocessable = (detail: string, extra?: Record<string, unknown>) =>
  new HttpError(422, "Unprocessable Content", detail, extra);
export const conflict = (detail: string, extra?: Record<string, unknown>) => new HttpError(409, "Conflict", detail, extra);

/** RFC 9457 problem document. Extension members can't override the standard ones. */
export function problem(
  status: number,
  title: string,
  detail: string,
  requestId: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ ...extra, type: "about:blank", title, status, detail, requestId }), {
    status,
    headers: { ...headers, "content-type": "application/problem+json", "cache-control": "no-store", "x-request-id": requestId },
  });
}
