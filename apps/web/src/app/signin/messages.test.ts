import { describe, expect, it } from "vitest";
import { formatCountdown, isEmail, linkErrorMessage, requestErrorMessage } from "./messages";

describe("isEmail", () => {
  it.each(["riya@example.com", "  riya@example.co.in ", "a.b+c@sub.example.io"])("accepts %s", (v) => {
    expect(isEmail(v)).toBe(true);
  });
  it.each(["", "riya", "riya@", "riya@example", "riya @example.com", "@example.com"])("rejects %j", (v) => {
    expect(isEmail(v)).toBe(false);
  });
});

describe("requestErrorMessage", () => {
  it("names the wait when the server says how long", () => {
    expect(requestErrorMessage(429, 720)).toBe("Too many requests. Try again in 12 minutes.");
    expect(requestErrorMessage(429, 30)).toBe("Too many requests. Try again in 1 minute.");
  });
  it("falls back to a vague wait without a usable Retry-After", () => {
    expect(requestErrorMessage(429, null)).toBe("Too many requests. Try again in a few minutes.");
    expect(requestErrorMessage(429, Number.NaN)).toBe("Too many requests. Try again in a few minutes.");
  });
  it("treats 400 as a bad address and anything else as a retryable failure", () => {
    expect(requestErrorMessage(400, null)).toBe("Enter an email like name@example.com");
    expect(requestErrorMessage(500, null)).toMatch(/try again/);
    expect(requestErrorMessage(0, null)).toMatch(/connection/);
  });
});

describe("linkErrorMessage", () => {
  it("explains an expired or used link", () => {
    expect(linkErrorMessage("INVALID_TOKEN")).toMatch(/expired or was already used/);
  });
  it("has a generic message for other failures and nothing without an error", () => {
    expect(linkErrorMessage("failed_to_create_session")).toMatch(/couldn’t sign you in/);
    expect(linkErrorMessage(undefined)).toBeNull();
  });
});

describe("formatCountdown", () => {
  it("renders m:ss", () => {
    expect(formatCountdown(30)).toBe("0:30");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(75)).toBe("1:15");
  });
});
