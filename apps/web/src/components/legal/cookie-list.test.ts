import { createCookieGetter } from "better-auth/cookies";
import { describe, expect, it } from "vitest";
import { authCookieOptions } from "@/server/auth/cookies";
import { THEME_COOKIE } from "@/lib/theme";
import { testConfig } from "../../../tests/support/config";
import { COOKIES } from "./cookie-list";

describe("COOKIES", () => {
  it("names the cookies the app actually sets", () => {
    const authCookie = createCookieGetter({ baseURL: testConfig.appOrigin, advanced: authCookieOptions(testConfig) });
    expect(COOKIES.map((c) => c.name)).toEqual([authCookie("session_token").name, authCookie("state").name, THEME_COOKIE]);
  });
});
