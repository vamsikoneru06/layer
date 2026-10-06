import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { CrowdCanvas } from "@/components/ui/crowd-canvas";

export default function Landing() {
  return (
    <main className="relative min-h-svh overflow-hidden bg-bg text-text">
      <div className="pointer-events-none absolute inset-0">
        <CrowdCanvas src="/images/crowd-peeps.png" rows={15} cols={7} className="h-[90%] [filter:var(--art-filter)]" />
      </div>

      <header className="relative z-10 mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-1">
          <ButtonLink href="/templates" variant="secondary" className="hidden h-[34px] px-3.5 sm:inline-flex">
            Templates
          </ButtonLink>
          <ButtonLink href="/signin" variant="secondary" className="h-[34px] px-3.5">
            Sign in
          </ButtonLink>
          <ButtonLink href="/home" className="h-[34px] px-4">
            Start designing
          </ButtonLink>
        </nav>
      </header>

      <section className="relative z-10 mx-auto mt-12 flex max-w-[980px] flex-col items-center gap-[26px] px-4 text-center sm:mt-[84px] sm:px-6">
        <h1 className="text-[clamp(44px,8vw,96px)] leading-[.96] font-bold tracking-[-0.035em] text-balance">
          Your photos. Any template. Done in a minute.
        </h1>
        <p className="max-w-[440px] text-[19px] leading-normal text-muted">
          Pick a template, drop in your photos, export. Free to use. All you need to sign in is an email address.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <ButtonLink href="/home" size="lg" className="px-[26px]">
            Start designing
          </ButtonLink>
          <ButtonLink href="/templates" variant="secondary" size="lg" className="px-[26px]">
            Browse templates
          </ButtonLink>
        </div>
      </section>

      <footer className="absolute inset-x-0 bottom-0 z-10 flex justify-center gap-4 pb-4 text-xs text-muted">
        <Link href="/terms" className="hover:text-text">
          Terms
        </Link>
        <Link href="/privacy" className="hover:text-text">
          Privacy
        </Link>
        <Link href="/cookies" className="hover:text-text">
          Cookies
        </Link>
      </footer>
    </main>
  );
}
