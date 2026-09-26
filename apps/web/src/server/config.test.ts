import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";

const base = {
  DATABASE_URL: "postgres://vash:vash@localhost:5432/vash",
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

  it("requires https, a real mailer and a trusted proxy in production", () => {
    const message = errorOf({ ...base, NODE_ENV: "production" });
    expect(message).toContain("RESEND_API_KEY");
    expect(message).toContain("APP_ORIGIN");
    expect(message).toContain("TRUST_PROXY");
  });

  it("enables Resend when a key and sender are present", () => {
    expect(loadConfig({ ...base, RESEND_API_KEY: "re_x", MAIL_FROM: "VASH <hi@vash.test>" }).mail).toEqual({
      kind: "resend",
      apiKey: "re_x",
      from: "VASH <hi@vash.test>",
    });
  });

  it("enables free Gmail sending with an app password, sending as that address by default", () => {
    expect(loadConfig({ ...base, GMAIL_USER: "vash.app@gmail.com", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" }).mail).toEqual({
      kind: "gmail",
      user: "vash.app@gmail.com",
      appPassword: "abcd efgh ijkl mnop",
      from: "VASH <vash.app@gmail.com>",
    });
  });

  it("requires both Gmail settings or neither", () => {
    expect(errorOf({ ...base, GMAIL_USER: "vash.app@gmail.com" })).toContain("GMAIL_APP_PASSWORD");
  });

  it("accepts Gmail instead of Resend in production", () => {
    const message = errorOf({ ...base, NODE_ENV: "production", GMAIL_USER: "vash.app@gmail.com", GMAIL_APP_PASSWORD: "x".repeat(16) });
    expect(message).not.toContain("RESEND_API_KEY");
  });

  it("reads TRUST_PROXY", () => {
    expect(loadConfig({ ...base, TRUST_PROXY: "true" }).trustProxy).toBe(true);
  });
});
