import Link from "next/link";
import { Contact, GrievanceOfficer, LegalPage } from "@/components/legal/legal-page";

export const metadata = { title: "Privacy · VASH" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="8 October 2026">
      <p>
        VASH is a free photo design editor run by an individual based in India, who is responsible for your personal data here (the
        &ldquo;Data Fiduciary&rdquo; under India&apos;s Digital Personal Data Protection Act, 2023). This page explains what we collect,
        why, who helps us run VASH, how long we keep it, and how to use your rights. We don&apos;t sell your data, we don&apos;t show
        ads, and we don&apos;t use analytics or tracking scripts.
      </p>

      <h2>What we collect and why</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your email address and name, to sign you in and show your name in the app. If you sign in with
          Google, we receive your name, email address and profile picture link from Google. We never see your Google password.
        </li>
        <li>
          <strong>Your work:</strong> the designs, folders and photos you create or upload, to save them and show them only to you.
        </li>
        <li>
          <strong>Designs made without signing in:</strong> kept only in your browser&apos;s storage on your device. We don&apos;t
          receive them. When you sign in, VASH moves them to your account and deletes them from the browser. Until then, clearing
          your browser&apos;s site data deletes them, and you can delete each one on the Designs page.
        </li>
        <li>
          <strong>Sign-in sessions:</strong> a record for each device you sign in on, which can include its IP address and browser name,
          to keep you signed in and to spot misuse of your account.
        </li>
        <li>
          <strong>Two-step verification (administrators only):</strong> the key for your authenticator app and your backup codes, both
          stored encrypted, and when each signed-in device last entered a code. Admin tools use this to check it&apos;s really you.
        </li>
        <li>
          <strong>Abuse limits:</strong> short-lived counters, keyed by account or IP address, that stop too many requests in a short
          time and protect the service from attacks.
        </li>
        <li>
          <strong>Error reports:</strong> when something breaks, a report of the error so we can fix it: the page path, the error
          message, your browser and operating system, and the app&apos;s last few steps before the error. Email addresses, share codes
          and the query part of links are removed before it&apos;s sent. It never includes your photos, designs or cookies.
        </li>
        <li>
          <strong>Reports:</strong> if you report a template, we keep the report and your account id so we can review it.
        </li>
      </ul>
      <p>
        We use this data only to provide VASH, keep it secure, and meet legal obligations. You give consent when you create an account,
        and you can withdraw it at any time by deleting your account. For visitors in the EU or UK, we rely on the performance of our
        agreement with you (running your account) and our legitimate interest in keeping VASH secure.
      </p>

      <h2>Sign in with Google</h2>
      <p>
        VASH&apos;s use and transfer of information received from Google APIs follows the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
        including the Limited Use requirements. We only ask Google for your basic profile and email address, and use them only to sign
        you in.
      </p>

      <h2>Cookies</h2>
      <ul>
        <li>A session cookie that keeps you signed in. It&apos;s required for the app to work.</li>
        <li>An appearance cookie, only if you choose Light or Dark in Settings, so the app opens in your chosen theme.</li>
      </ul>
      <p>
        If you make designs without signing in, they&apos;re kept in this site&apos;s storage in your browser (IndexedDB). That
        storage isn&apos;t a cookie and isn&apos;t sent to us. There are no advertising or analytics cookies, so there&apos;s no cookie
        banner.
      </p>

      <h2>Who helps us run VASH</h2>
      <p>These service providers process data for us, only to provide VASH:</p>
      <ul>
        <li>Vercel hosts the website.</li>
        <li>Neon hosts the database with your account and designs, and the photos you upload unless a separate photo store is set up.</li>
        <li>Supabase stores the photos you upload, when it&apos;s set up as that photo store.</li>
        <li>Google handles &ldquo;Sign in with Google&rdquo; and sends our sign-in emails.</li>
        <li>Sentry receives the error reports described above.</li>
        <li>GitHub stores encrypted copies of the database, as backups.</li>
      </ul>
      <p>
        Their servers may be outside India, for example in the United States. We only use providers that protect data with security
        measures and contracts suited to this. We may also disclose data when Indian law requires it, for example to a lawful request
        from a government agency or to CERT-In.
      </p>

      <h2>Who can see your designs</h2>
      <p>
        Your designs and photos are private to your account. Uploaded photos are kept in private storage and are only shown to you
        through links that expire within an hour. A design becomes public only if you choose to publish it as a template.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Your account, designs and photos: until you delete them or your account.</li>
        <li>Sign-in sessions: until you sign out, or 30 days without use.</li>
        <li>Two-step verification key and backup codes: until you turn it off or delete your account.</li>
        <li>Abuse-limit counters: up to two days.</li>
        <li>Error reports: up to 90 days, then Sentry deletes them.</li>
        <li>Encrypted database backups: 7 days.</li>
        <li>
          After you delete your account: your data is removed at once and photo files are deleted from storage shortly after. We keep a
          single record that an account with a given internal id was deleted, with no name or email, to show we acted on the request.
        </li>
        <li>Our providers&apos; backups and logs may hold copies for a short time before they expire under their own policies.</li>
      </ul>

      <h2>How we protect it</h2>
      <p>
        Everything is sent over HTTPS and stored with our providers&apos; encryption. Each account can only reach its own data, photos are
        checked to be real images before they&apos;re accepted, requests are rate-limited, and admin tools need two-step verification. If a breach of personal data happens, we
        will inform the people affected and report it to the Data Protection Board of India and to CERT-In as the law requires.
      </p>

      <h2>Your rights</h2>
      <ul>
        <li>
          <strong>See and download your data:</strong> in <Link href="/settings">Settings</Link>, &ldquo;Download my data&rdquo;.
        </li>
        <li>
          <strong>Correct it:</strong> change your name in <Link href="/settings">Settings</Link>, or ask us to correct anything else.
        </li>
        <li>
          <strong>Delete it and withdraw consent:</strong> &ldquo;Delete my account&rdquo; in <Link href="/settings">Settings</Link>.
        </li>
        <li>
          <strong>Nominate someone</strong> to exercise these rights for you if you die or become unable to, by writing to us.
        </li>
        <li>
          <strong>Complain:</strong> to our Grievance Officer (below). If you&apos;re not satisfied, you can complain to the Data Protection
          Board of India. Visitors in the EU or UK can also object to or restrict processing and complain to their data protection
          authority.
        </li>
      </ul>
      <p>We answer requests within 30 days.</p>
      <Contact before="For any request or question about your data, email" />

      <h2>Children</h2>
      <p>VASH is only for people aged 18 or over. If we learn that a child&apos;s data was collected, we delete it.</p>

      <h2>Changes</h2>
      <p>
        If we change how we handle your data, we&apos;ll update this page and the date at the top, and tell you by email about significant
        changes before they take effect. See also our <Link href="/terms">Terms</Link>.
      </p>

      <GrievanceOfficer />
    </LegalPage>
  );
}
