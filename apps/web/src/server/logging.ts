export type LogFields = Record<string, unknown>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const SENSITIVE_KEY = /email|token|secret|password|cookie|authorization|api_?key/i;
const URL_CREDENTIALS = /\/\/[^/\s:@]+:[^@\s]+@/g;

/** Drizzle's "Failed query: <sql>\nparams: <values>" carries bound values; keep only the fact it failed. */
function safeMessage(message: string): string {
  const text = message.startsWith("Failed query:") ? "Failed query (SQL and parameters omitted)" : message;
  return text.replace(URL_CREDENTIALS, "//[redacted]@");
}

function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    const cause = (value as { cause?: unknown }).cause;
    const code = (value as { code?: unknown }).code;
    return {
      name: value.name,
      message: safeMessage(value.message),
      ...(typeof code === "string" ? { code } : {}),
      ...(cause !== undefined && depth < 3 ? { cause: redact(cause, depth + 1) } : {}),
    };
  }
  if (value === null || typeof value !== "object") return value;
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1)]),
  );
}

export type ErrorReporter = (err: unknown, tags: { event: string; requestId?: string }) => void;

/** `onError` gets the raw `err` of every error event, for an error tracker that scrubs on its own. */
export function createLogger(
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  now: () => Date = () => new Date(),
  onError?: ErrorReporter,
): Logger {
  const at =
    (level: "info" | "warn" | "error") =>
    (event: string, fields: LogFields = {}) =>
      write(JSON.stringify({ time: now().toISOString(), level, event, ...(redact(fields) as LogFields) }));
  const logError = at("error");
  return {
    info: at("info"),
    warn: at("warn"),
    error(event, fields = {}) {
      logError(event, fields);
      if (!onError || fields.err === undefined) return;
      try {
        onError(fields.err, { event, ...(typeof fields.requestId === "string" ? { requestId: fields.requestId } : {}) });
      } catch {
        // Reporting is best effort; the log line above is already written.
      }
    },
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
