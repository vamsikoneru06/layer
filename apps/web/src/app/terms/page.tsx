import Link from "next/link";
import { Contact, LegalPage } from "@/components/legal/legal-page";

export const metadata = { title: "Terms · VASH" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms and Conditions" updated="27 September 2026">
      <p>
        These terms cover your use of VASH, a free photo design editor. By creating an account or using VASH, you agree to them. If you don&apos;t
        agree, please don&apos;t use VASH.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You need an email address or a Google account to sign in. Keep access to it safe, since anyone who can read your email can sign in as you.</li>
        <li>You must be 18 or over, or have a parent&apos;s or guardian&apos;s permission.</li>
        <li>One person per account. Don&apos;t sign in as someone else.</li>
      </ul>

      <h2>Your content</h2>
      <ul>
        <li>The photos you upload and the designs you make are yours. We don&apos;t claim ownership of them.</li>
        <li>
          You give us permission to store, process and display your content only as needed to run VASH for you: saving it, showing it to you,
          and turning it into the files you export.
        </li>
        <li>Only upload photos you have the right to use. If a photo shows other people, make sure they&apos;re fine with it.</li>
      </ul>

      <h2>Templates and fonts</h2>
      <ul>
        <li>You can use VASH templates in anything you make with them, personal or commercial.</li>
        <li>You can&apos;t resell or redistribute the templates themselves as templates.</li>
        <li>The fonts are open-source (SIL Open Font License), so the designs you export can be used freely.</li>
      </ul>

      <h2>What you can&apos;t do</h2>
      <ul>
        <li>Upload or make anything illegal, sexual content involving minors, or content that harasses, threatens or impersonates someone.</li>
        <li>Upload content that infringes someone else&apos;s copyright or trademark.</li>
        <li>Try to break, overload or get around the limits and security of VASH, or access other people&apos;s accounts or data.</li>
        <li>Use automated tools to create accounts or scrape the service.</li>
      </ul>
      <p>We may remove content or suspend accounts that break these rules.</p>

      <h2>The service</h2>
      <ul>
        <li>VASH is free. We may add, change or remove features, and we set usage limits (for example on uploads) to keep it running for everyone.</li>
        <li>
          We work to keep your designs safe, but VASH is provided &ldquo;as is&rdquo; without guarantees. Keep your own copies of anything
          important by exporting it.
        </li>
        <li>As far as the law allows, we aren&apos;t liable for indirect losses or for lost data arising from your use of VASH.</li>
      </ul>

      <h2>Ending your use</h2>
      <p>
        You can stop using VASH and delete your account at any time. Deleting it removes your designs and photos as described in our{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>Changes and law</h2>
      <p>
        If we change these terms, we&apos;ll update this page and the date at the top, and tell you by email about big changes. These terms are
        governed by the laws of India.
      </p>
      <Contact before="Questions about these terms? Email" />
    </LegalPage>
  );
}
