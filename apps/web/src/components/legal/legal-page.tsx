import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";

/** Shared frame for the Terms and Privacy pages: plain, readable text with links between the two. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="min-h-svh bg-bg text-text">
      <header className="mx-auto flex h-16 max-w-[720px] items-center px-4 sm:px-6">
        <Logo />
      </header>
      <article className="mx-auto flex max-w-[720px] flex-col gap-5 px-4 pt-8 pb-20 text-[15px] leading-relaxed sm:px-6 [&_a]:underline [&_a]:underline-offset-4 [&_a]:transition-opacity [&_a:hover]:opacity-65 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
        <div className="flex flex-col gap-2">
          <h1 className="text-[clamp(30px,5vw,40px)] leading-tight font-bold tracking-[-0.03em]">{title}</h1>
          <p className="text-sm text-muted">Last updated {updated}</p>
        </div>
        {children}
      </article>
      <footer className="mx-auto flex max-w-[720px] gap-4 border-t-[.5px] border-line px-4 py-6 text-sm text-muted sm:px-6">
        <Link href="/terms" className="hover:text-text">
          Terms
        </Link>
        <Link href="/privacy" className="hover:text-text">
          Privacy
        </Link>
      </footer>
    </main>
  );
}

/** The operator's public contact details, from the environment so they're never guessed or hard-coded. */
export function operator(): { email: string | null; grievanceOfficer: string | null } {
  return { email: process.env.CONTACT_EMAIL || null, grievanceOfficer: process.env.GRIEVANCE_OFFICER_NAME || null };
}

/** "Email us at …" when CONTACT_EMAIL is set; otherwise nothing, rather than a made-up address. */
export function Contact({ before }: { before: string }) {
  const { email } = operator();
  if (!email) return null;
  return (
    <p>
      {before} <a href={`mailto:${email}`}>{email}</a>.
    </p>
  );
}

/**
 * The Grievance Officer section required of platforms hosting user content in India (IT Rules 2021,
 * rule 3(2)) and for data complaints under the DPDP Act 2023. Shows the configured name and email.
 */
export function GrievanceOfficer() {
  const { email, grievanceOfficer } = operator();
  return (
    <>
      <h2>Grievance Officer</h2>
      <p>
        For complaints about content on VASH, about these terms, or about your personal data, contact our Grievance Officer
        {grievanceOfficer ? (
          <>
            , <strong>{grievanceOfficer}</strong>
          </>
        ) : null}
        {email ? (
          <>
            , at <a href={`mailto:${email}`}>{email}</a>
          </>
        ) : null}
        . We acknowledge complaints within 24 hours and resolve them within 15 days. Complaints about content showing a person in a
        sexual or intimate way without consent, or impersonating someone, are acted on within 24 hours.
      </p>
    </>
  );
}
