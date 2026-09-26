/** Pure helpers for the sign-in form, kept apart so they run under the node test environment. */

export const RESEND_COOLDOWN_SECONDS = 30;

export function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(value.trim());
}

/** `status` 0 means the request never reached the server. */
export function requestErrorMessage(status: number, retryAfterSeconds: number | null): string {
  if (status === 429) {
    if (retryAfterSeconds === null || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
      return "Too many requests — try again in a few minutes.";
    }
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    return `Too many requests — try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  if (status === 400) return "Enter an email like name@example.com";
  if (status === 0) return "Couldn’t reach VASH. Check your connection and try again.";
  return "Something went wrong sending your link. Please try again.";
}

/** Better Auth sends expired and already-used links back with the same code. */
export function linkErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "INVALID_TOKEN") return "That sign-in link expired or was already used. Send yourself a new one.";
  return "We couldn’t sign you in with that link. Send yourself a new one.";
}

export function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
