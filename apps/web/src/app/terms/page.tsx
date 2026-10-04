import Link from "next/link";
import { GrievanceOfficer, LegalPage } from "@/components/legal/legal-page";

export const metadata = { title: "Terms · VASH" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms and Conditions" updated="28 September 2026">
      <p>
        These terms are an agreement between you and the operator of VASH (&ldquo;we&rdquo;, &ldquo;us&rdquo;), an individual based in
        India. They cover your use of VASH, a free photo design editor. By creating an account or using VASH, you agree to them and to
        our <Link href="/privacy">Privacy Policy</Link>. If you don&apos;t agree, please don&apos;t use VASH.
      </p>

      <h2>Who can use VASH</h2>
      <ul>
        <li>You must be 18 or older.</li>
        <li>You need an email address or a Google account to sign in. Keep it secure: anyone who can read your email can sign in as you.</li>
        <li>One person per account. Don&apos;t sign in as someone else or create accounts with automated tools.</li>
      </ul>

      <h2>Your content</h2>
      <ul>
        <li>The photos you upload and the designs you make are yours. We don&apos;t claim ownership of them.</li>
        <li>
          While they&apos;re private, you let us store, process and display them only as needed to run VASH for you: saving them, showing
          them to you, and turning them into the files you export.
        </li>
        <li>
          If you publish a design as a template, you give us and every VASH user a free, worldwide, non-exclusive licence to show,
          copy and adapt it (including any photos you chose to keep in it) to make their own designs. You can unpublish it at any
          time; designs people already made from it stay theirs.
        </li>
        <li>Only upload or publish content you have the right to use. If a photo shows other people, make sure they agree to it.</li>
      </ul>

      <h2>What you can&apos;t upload, publish or share</h2>
      <p>Anything that:</p>
      <ul>
        <li>belongs to someone else and you don&apos;t have the right to use;</li>
        <li>is obscene, pornographic, paedophilic, or invades another person&apos;s privacy, including their bodily privacy;</li>
        <li>insults or harasses anyone on the basis of gender, or is racially or ethnically objectionable;</li>
        <li>encourages money laundering or gambling, or is otherwise illegal;</li>
        <li>is harmful to children;</li>
        <li>infringes a patent, trademark, copyright or other proprietary right;</li>
        <li>deceives or misleads people about where it came from, or knowingly spreads false or misleading information;</li>
        <li>impersonates another person;</li>
        <li>threatens the unity, integrity, defence, security or sovereignty of India, its friendly relations with other countries, or public order, or incites an offence;</li>
        <li>contains viruses or other code meant to disrupt or damage any computer or system;</li>
        <li>breaks any law in force.</li>
      </ul>
      <p>
        You also can&apos;t try to break, overload or get around VASH&apos;s limits and security, access other people&apos;s accounts or
        data, or scrape the service.
      </p>
      <p>
        If you break these rules, we may remove the content, limit or suspend your account, and, where the law requires, report it and
        keep related records for the time the law sets. We remind all users of these rules at least once a year.
      </p>

      <h2>Reporting content and copyright complaints</h2>
      <p>
        If you see content on VASH that breaks these rules, or that uses your work without permission, tell our Grievance Officer
        (details below). For a copyright complaint, include: the work you own, where it appears on VASH, your contact details, and a
        statement that you own the rights and that the information is accurate. We may share a complaint with the person who posted
        the content so they can respond.
      </p>

      <h2>Templates, fonts and other material</h2>
      <ul>
        <li>You can use VASH templates in anything you make with them, personal or commercial.</li>
        <li>You can&apos;t resell or redistribute the templates themselves as templates.</li>
        <li>The fonts are open-source (SIL Open Font License), so the designs you export can be used freely.</li>
        <li>The VASH name and logo belong to us; don&apos;t use them in a way that suggests we endorse you.</li>
      </ul>

      <h2>The service</h2>
      <ul>
        <li>VASH is free. We may add, change or remove features, and we set usage limits (for example on uploads) to keep it running for everyone.</li>
        <li>
          VASH is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind. We work to keep your
          designs safe, but keep your own copies of anything important by exporting it.
        </li>
        <li>
          As far as the law allows, we aren&apos;t liable for indirect or consequential losses, lost data or lost profits, and our total
          liability to you for any claim is limited to ₹1,000, since the service is free.
        </li>
        <li>
          You agree to compensate us for claims, losses and costs caused by content you upload or publish, or by your breaking these
          terms or the law.
        </li>
      </ul>

      <h2>Ending your use</h2>
      <p>
        You can stop using VASH and delete your account at any time in Settings. Deleting it removes your designs and photos as
        described in our <Link href="/privacy">Privacy Policy</Link>. We may suspend or close accounts that break these terms.
      </p>

      <h2>Changes and law</h2>
      <p>
        If we change these terms, we&apos;ll update this page and the date at the top, and tell you by email about significant changes
        before they take effect. These terms are governed by the laws of India, including the Information Technology Act, 2000 and
        the rules made under it. Disputes are subject to the jurisdiction of the courts in India.
      </p>

      <GrievanceOfficer />
    </LegalPage>
  );
}
