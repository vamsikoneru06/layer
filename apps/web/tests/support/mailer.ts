import type { MailMessage, Mailer } from "@/server/auth/mailer";

export function captureMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(m) {
      sent.push(m);
    },
  };
}
