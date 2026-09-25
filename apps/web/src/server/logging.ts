export type LogFields = Record<string, unknown>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const SENSITIVE_KEY = /email|token|secret|password|cookie|authorization|api_?key/i;

function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    const cause = (value as { cause?: unknown }).cause;
    const code = (value as { code?: unknown }).code;
    return {
      name: value.name,
      // Drizzle appends "\nparams: …" with bound values (emails, tokens); never log them.
      message: value.message.split("\nparams:")[0],
      ...(typeof code === "string" ? { code } : {}),
      ...(cause !== undefined && depth < 3 ? { cause: redact(cause, depth + 1) } : {}),
    };
  }
  if (value === null || typeof value !== "object" || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1)]),
  );
}

export function createLogger(
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  now: () => Date = () => new Date(),
): Logger {
  const at =
    (level: "info" | "warn" | "error") =>
    (event: string, fields: LogFields = {}) =>
      write(JSON.stringify({ time: now().toISOString(), level, event, ...(redact(fields) as LogFields) }));
  return { info: at("info"), warn: at("warn"), error: at("error") };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
