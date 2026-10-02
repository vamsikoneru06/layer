import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ImageStreamHero } from "@/components/ui/image-stream-hero";
import { linkErrorMessage } from "./messages";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Sign in · VASH" };

// 1–9 from the design handoff (Unsplash); 10–18 from Pexels (credits in public/samples/CREDITS.txt).
const STREAM = Array.from({ length: 18 }, (_, i) => `/images/stream/${i + 1}.jpg`);

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { error } = await searchParams;
  // Mirrors loadConfig, which only enables the provider when both are set.
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  return (
    <main className="grid min-h-svh bg-bg text-text lg:grid-cols-[600px_minmax(0,1fr)]">
      <section className="flex flex-col px-6 py-8 sm:px-14">
        <Logo />
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-12">
          <SignInForm googleEnabled={googleEnabled} initialError={linkErrorMessage(typeof error === "string" ? error : undefined)} />
        </div>
        <p className="flex gap-3 text-xs text-muted">
          <Link href="/terms" className="hover:text-text">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-text">
            Privacy
          </Link>
        </p>
      </section>
      <div className="relative hidden py-3 pr-3 lg:block">
        <ImageStreamHero images={STREAM} className="size-full rounded-[28px] bg-bg2" />
      </div>
    </main>
  );
}
