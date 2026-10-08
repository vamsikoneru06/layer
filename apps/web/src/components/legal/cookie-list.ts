import { THEME_COOKIE } from "@/lib/theme";

/** Every cookie VASH sets, shown on the Cookie Policy. cookie-list.test.ts checks the names against the code that sets them. */
export const COOKIES = [
  {
    name: "better-auth.session_token",
    purpose: "Keeps you signed in.",
    when: "After you sign in.",
    lasts: "30 days, renewed while you keep using VASH. Removed when you sign out.",
  },
  {
    name: "better-auth.state",
    purpose: "Checks that you started the Google sign-in on VASH, so another site can't quietly sign your browser in to a different account.",
    when: "Only while you sign in with Google.",
    lasts: "5 minutes.",
  },
  {
    name: THEME_COOKIE,
    purpose: "Remembers your appearance choice so pages open in that theme.",
    when: "Only if you choose Light or Dark in Settings.",
    lasts: "1 year. Removed when you choose System.",
  },
] as const;
