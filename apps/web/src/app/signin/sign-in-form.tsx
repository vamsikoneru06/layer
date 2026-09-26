"use client";

import { CircleAlert, Mail, RotateCw } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { formatCountdown, isEmail, requestErrorMessage, RESEND_COOLDOWN_SECONDS } from "./messages";

// Where Better Auth sends people after they click the emailed link (or return from Google).
// New accounts land on /home too until /onboarding exists; pointing them at it today is a 404.
const REDIRECTS = { callbackURL: "/home", newUserCallbackURL: "/home", errorCallbackURL: "/signin" };

type Phase = "form" | "sending" | "sent";

async function post(path: string, body: object): Promise<Response | null> {
  try {
    return await fetch(`/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

function errorFor(res: Response | null): string {
  if (!res) return requestErrorMessage(0, null);
  const retryAfter = res.headers.get("x-retry-after") ?? res.headers.get("retry-after");
  return requestErrorMessage(res.status, retryAfter === null ? null : Number(retryAfter));
}

export function SignInForm({ googleEnabled, initialError }: { googleEnabled: boolean; initialError: string | null }) {
  const [phase, setPhase] = useState<Phase>("form");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const sentHeading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const [emailId, errorId] = [`${id}-email`, `${id}-error`];

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (phase === "sent") sentHeading.current?.focus();
  }, [phase]);

  const requestLink = () => post("/sign-in/magic-link", { email: email.trim(), ...REDIRECTS });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (phase !== "form") return;
    if (!isEmail(email)) return setError(requestErrorMessage(400, null));
    setError(null);
    setPhase("sending");
    const res = await requestLink();
    if (res?.ok) {
      setPhase("sent");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } else {
      setError(errorFor(res));
      setPhase("form");
    }
  }

  async function resend() {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    const res = await requestLink();
    setResending(false);
    if (res?.ok) setCooldown(RESEND_COOLDOWN_SECONDS);
    else setError(errorFor(res));
  }

  async function continueWithGoogle() {
    setGoogleBusy(true);
    setError(null);
    const res = await post("/sign-in/social", { provider: "google", ...REDIRECTS });
    const data = res?.ok ? ((await res.json()) as { url?: string }) : null;
    if (data?.url) return window.location.assign(data.url);
    setGoogleBusy(false);
    setError(errorFor(res));
  }

  const errorLine = error && (
    <p id={errorId} role="alert" className="flex items-center gap-1.5 text-[13px] text-danger">
      <CircleAlert aria-hidden className="size-3.5 flex-none" />
      {error}
    </p>
  );

  if (phase === "sent") {
    return (
      <div className="flex flex-col gap-8">
        <div className="glass-primary flex size-14 items-center justify-center rounded-[18px] text-white">
          <Mail aria-hidden className="size-6" />
        </div>
        <div className="flex flex-col gap-2.5">
          <h1 ref={sentHeading} tabIndex={-1} className="text-[clamp(40px,10vw,52px)] leading-none font-bold tracking-[-0.035em] outline-none">
            Check your inbox
          </h1>
          <p className="text-base leading-normal text-muted">
            We sent a link to <span className="font-medium text-text">{email.trim()}</span>. It expires in 10 minutes.
          </p>
        </div>
        <div className="flex flex-col gap-2.5">
          <Button
            variant="secondary"
            size="lg"
            className="w-full px-4 disabled:opacity-50"
            onClick={resend}
            loading={resending}
            disabled={cooldown > 0}
            icon={cooldown > 0 ? undefined : <RotateCw aria-hidden className="size-4" />}
          >
            {resending ? "Sending…" : cooldown > 0 ? (
              <>
                Resend in <span className="text-sm text-muted tabular-nums">{formatCountdown(cooldown)}</span>
              </>
            ) : (
              "Resend link"
            )}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="w-full px-4"
            onClick={() => {
              setPhase("form");
              setCooldown(0);
              setError(null);
            }}
          >
            Use a different email
          </Button>
          {errorLine}
        </div>
        <p className="text-[13px] leading-normal text-muted">Can’t find it? Check spam, or search your inbox for “VASH”.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2.5">
        <h1 className="text-[clamp(40px,10vw,52px)] leading-none font-bold tracking-[-0.035em]">Sign in</h1>
        <p className="text-base leading-[1.45] text-muted">Designs you made as a guest will move into your account.</p>
      </div>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
        {googleEnabled && (
          <>
            <Button variant="secondary" size="lg" className="w-full px-4" onClick={continueWithGoogle} loading={googleBusy} icon={<GoogleMark />}>
              Continue with Google
            </Button>
            <div className="flex items-center gap-3 text-[13px] text-muted">
              <span className="h-[.5px] flex-1 bg-line" />
              or
              <span className="h-[.5px] flex-1 bg-line" />
            </div>
          </>
        )}
        <div className="flex flex-col gap-2">
          <label htmlFor={emailId} className="text-[13px] font-medium">
            Email
          </label>
          <input
            id={emailId}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            className="field"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          {errorLine}
        </div>
        <Button type="submit" size="lg" className="w-full px-4" loading={phase === "sending"}>
          {phase === "sending" ? "Sending…" : "Email me a sign-in link"}
        </Button>
      </form>
      <p className="text-[13px] leading-normal text-muted">No password needed. The link expires in 10 minutes.</p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="size-[18px] flex-none">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
