import Link from "next/link";
import { COOKIES } from "@/components/legal/cookie-list";
import { Contact, LegalPage } from "@/components/legal/legal-page";

export const metadata = { title: "Cookies · VASH" };

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie Policy" updated="7 October 2026">
      <p>
        A cookie is a small piece of text a website asks your browser to keep and send back on later visits. VASH sets the{" "}
        {COOKIES.length} cookies below. Each one is needed for something you asked for, like staying signed in. None of them follow you
        to other sites, and none are shared with anyone.
      </p>

      <h2>The cookies VASH sets</h2>
      <div className="flex flex-col gap-3">
        {COOKIES.map((cookie) => (
          <section key={cookie.name} className="flex flex-col gap-2 rounded-xl border-[.5px] border-line p-4">
            <h3 className="font-mono text-sm font-semibold break-all">{cookie.name}</h3>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[110px_1fr]">
              <dt className="text-muted">What it does</dt>
              <dd className="mb-1 sm:mb-0">{cookie.purpose}</dd>
              <dt className="text-muted">When it&apos;s set</dt>
              <dd className="mb-1 sm:mb-0">{cookie.when}</dd>
              <dt className="text-muted">How long</dt>
              <dd>{cookie.lasts}</dd>
            </dl>
          </section>
        ))}
      </div>
      <p>
        On the live site, the two sign-in cookie names start with <code>__Secure-</code>. That tells your browser to send them only over
        a secure (HTTPS) connection. Both are also hidden from scripts on the page, so they can&apos;t be read by code running in your
        browser.
      </p>

      <h2>What VASH doesn&apos;t use</h2>
      <p>
        No advertising, analytics or social media cookies, and no third-party scripts that could set their own. That&apos;s why there&apos;s
        no cookie banner: there&apos;s nothing optional to accept or refuse.
      </p>

      <h2>Storage that isn&apos;t a cookie</h2>
      <p>
        VASH remembers whether you view your Designs as a grid or a list in your browser&apos;s local storage. It stays on your device
        and isn&apos;t sent to us.
      </p>

      <h2>Removing or blocking cookies</h2>
      <p>
        You can delete VASH&apos;s cookies in your browser&apos;s settings at any time. Deleting the session cookie signs you out.
        Deleting the appearance cookie makes VASH follow your device&apos;s light or dark setting again. If you block cookies for this
        site, you can still read these pages, but you can&apos;t sign in.
      </p>

      <h2>Changes</h2>
      <p>
        If VASH starts using a new cookie, this page is updated in the same change and the date at the top moves. How we handle the
        rest of your data is in our <Link href="/privacy">Privacy Policy</Link>.
      </p>
      <Contact before="Questions about cookies? Email us at" />
    </LegalPage>
  );
}
