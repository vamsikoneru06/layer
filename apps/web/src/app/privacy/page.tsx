import Link from "next/link";
import { Contact, LegalPage } from "@/components/legal/legal-page";

export const metadata = { title: "Privacy · VASH" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="27 September 2026">
      <p>
        VASH is a photo design editor. This page explains what we store when you use it, why, who helps us run it, and how to get your data out or
        deleted. We don&apos;t sell your data, we don&apos;t show ads, and we don&apos;t use analytics or tracking scripts.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your email address and name. If you sign in with Google, we also get your Google profile picture link. We
          never see your Google password.
        </li>
        <li>
          <strong>Your work:</strong> the designs, folders and photos you create or upload.
        </li>
        <li>
          <strong>Sign-in sessions:</strong> a session record for each device you sign in on, which can include the device&apos;s IP address and
          browser name. Sessions end after 30 days without use, or when you sign out.
        </li>
        <li>
          <strong>Abuse limits:</strong> short-lived counters, keyed by account or IP address, that stop too many requests in a short time. They
          are cleared within two days.
        </li>
        <li>
          <strong>Reports:</strong> if you report a template, we keep the report and your account id so we can review it.
        </li>
      </ul>

      <h2>Cookies</h2>
      <p>
        We use one kind of cookie: the session cookie that keeps you signed in. It&apos;s required for the app to work, so there&apos;s no cookie
        banner. There are no advertising or analytics cookies.
      </p>

      <h2>Who helps us run VASH</h2>
      <p>These services process data for us, only to provide VASH:</p>
      <ul>
        <li>Vercel hosts the website.</li>
        <li>Neon hosts the database with your account and designs.</li>
        <li>Supabase stores the photos you upload.</li>
        <li>Google handles &ldquo;Sign in with Google&rdquo; and sends our sign-in emails through Gmail.</li>
      </ul>
      <p>Their servers may be outside your country. Each of them has its own privacy policy.</p>

      <h2>Who can see your designs</h2>
      <p>
        Your designs and photos are private to your account. Uploaded photos are kept in private storage and are only served to you through
        short-lived links.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>You can download a copy of your account data, including your designs.</li>
        <li>You can delete your account. That removes your account, designs, folders and uploaded photos. Photo files are removed from storage shortly after.</li>
        <li>You can ask us to correct anything that&apos;s wrong.</li>
      </ul>
      <Contact before="For any of these, or any question about your data, email" />

      <h2>Children</h2>
      <p>VASH is meant for people aged 18 or over, or younger people using it with a parent&apos;s or guardian&apos;s permission.</p>

      <h2>Changes</h2>
      <p>
        If we change how we handle your data, we&apos;ll update this page and the date at the top. For big changes we&apos;ll also tell you by
        email. See also our <Link href="/terms">Terms</Link>.
      </p>
    </LegalPage>
  );
}
