import type { AppConfig } from "@/server/config";

export const testConfig: AppConfig = {
  nodeEnv: "test",
  isProduction: false,
  databaseUrl: "postgres://unused/test",
  appOrigin: "http://localhost:3000",
  authSecret: "test-secret-that-is-at-least-32-characters-long",
  trustProxy: true,
  google: null,
  mail: { kind: "console" },
};
