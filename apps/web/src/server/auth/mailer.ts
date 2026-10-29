import nodemailer from "nodemailer";
import type { Logger } from "../logging";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function magicLinkEmail(to: string, url: string): MailMessage {
  const note = "This link works once and expires in 10 minutes. If you didn't ask for it, you can ignore this email.";
  return {
    to,
    subject: "Your VASH sign-in link",
    text: `Sign in to VASH:\n\n${url}\n\n${note}`,
    html: `<p>Sign in to VASH:</p><p><a href="${escapeHtml(url)}">Sign in</a></p><p>${note}</p>`,
  };
}

export type TwoFactorChange = "enable" | "disable" | "backup_codes";

const TWO_FACTOR_CHANGES: Record<TwoFactorChange, { subject: string; what: string }> = {
  enable: { subject: "Two-step verification is on for your VASH account", what: "Two-step verification was turned on for your VASH account" },
  disable: { subject: "Two-step verification is off for your VASH account", what: "Two-step verification was turned off for your VASH account" },
  backup_codes: { subject: "New backup codes for your VASH account", what: "New two-step verification backup codes were made for your VASH account. The old codes no longer work" },
};

/** Tells the owner their two-step verification changed, so a change they didn't make doesn't go unnoticed. */
export function twoFactorChangeEmail(to: string, change: TwoFactorChange, at: Date): MailMessage {
  const { subject, what } = TWO_FACTOR_CHANGES[change];
  const when = `${at.toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "long", timeStyle: "short" })} UTC`;
  const lines = [
    `${what} on ${when}.`,
    "If you did this, there's nothing else to do.",
    "If you didn't, someone else may be signed in to your account. Sign in to VASH and check Settings, Two-step verification.",
  ];
  return { to, subject, text: lines.join("\n\n"), html: lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("") };
}

/** Development only (config refuses to boot production without Resend). */
export function consoleMailer(logger: Logger): Mailer {
  return {
    async send(m) {
      logger.info("mail.development", { subject: m.subject, body: m.text });
    },
  };
}

export function resendMailer(options: { apiKey: string; from: string }, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    async send(m) {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: options.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend rejected the email (HTTP ${res.status})`);
    },
  };
}

type SmtpTransport = { sendMail(message: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown> };

/** Gmail SMTP: free (about 500 messages a day) and needs no domain of your own. */
export function gmailMailer(
  options: { from: string; user?: string; appPassword?: string },
  transport: SmtpTransport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: options.user, pass: options.appPassword },
    connectionTimeout: 10_000,
  }),
): Mailer {
  return {
    async send(m) {
      try {
        await transport.sendMail({ from: options.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
      } catch {
        // SMTP replies can name the account; keep them out of logs and responses.
        throw new Error("Gmail rejected the email (check GMAIL_USER and GMAIL_APP_PASSWORD)");
      }
    },
  };
}
