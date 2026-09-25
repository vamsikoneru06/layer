import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";

const base = {
  DATABASE_URL: "postgres://layer:layer@localhost:5432/layer",
  APP_ORIGIN: "http://localhost:3000",
  BETTER_AUTH_SECRET: "s".repeat(32),
};

function errorOf(env: Record<string, string | undefined>): string {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return String(err);
  }
  throw new Error("expected loadConfig to throw");
}

describe("loadConfig", () => {
  it("parses a minimal development environment", () => {
    expect(loadConfig(base)).toMatchObject({
      nodeEnv: "development",
      isProduction: false,
      trustProxy: false,
      google: null,
      mail: { kind: "console" },
    });
  });

  it("names the bad variable without echoing its value", () => {
    const secret = "tooshort-but-still-secret";
    const message = errorOf({ ...base, BETTER_AUTH_SECRET: secret });
    expect(message).toContain("BETTER_AUTH_SECRET");
    expect(message).not.toContain(secret);
  });

  it("requires APP_ORIGIN to be a bare origin", () => {
    expect(errorOf({ ...base, APP_ORIGIN: "http://localhost:3000/app" })).toContain("APP_ORIGIN");
  });

  it("treats empty optional values as unset", () => {
    expect(loadConfig({ ...base, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", RESEND_API_KEY: "" }).google).toBeNull();
  });

  it("requires both Google credentials or neither", () => {
    expect(errorOf({ ...base, GOOGLE_CLIENT_ID: "id" })).toContain("GOOGLE_CLIENT_SECRET");
  });

  it("requires https and a real mailer in production", () => {
    const message = errorOf({ ...base, NODE_ENV: "production" });
    expect(message).toContain("RESEND_API_KEY");
    expect(message).toContain("APP_ORIGIN");
  });

  it("enables Resend when a key and sender are present", () => {
    expect(loadConfig({ ...base, RESEND_API_KEY: "re_x", MAIL_FROM: "Layer <hi@layer.test>" }).mail).toEqual({
      kind: "resend",
      apiKey: "re_x",
      from: "Layer <hi@layer.test>",
    });
  });

  it("reads TRUST_PROXY", () => {
    expect(loadConfig({ ...base, TRUST_PROXY: "true" }).trustProxy).toBe(true);
  });
});
