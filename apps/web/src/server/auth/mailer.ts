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
    subject: "Your Layer sign-in link",
    text: `Sign in to Layer:\n\n${url}\n\n${note}`,
    html: `<p>Sign in to Layer:</p><p><a href="${escapeHtml(url)}">Sign in</a></p><p>${note}</p>`,
  };
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
