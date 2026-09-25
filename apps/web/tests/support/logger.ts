import type { LogFields, Logger } from "@/server/logging";

export interface LogEntry {
  level: "info" | "warn" | "error";
  event: string;
  fields: LogFields;
}

export function captureLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const at = (level: LogEntry["level"]) => (event: string, fields: LogFields = {}) => void entries.push({ level, event, fields });
  return { entries, info: at("info"), warn: at("warn"), error: at("error") };
}
