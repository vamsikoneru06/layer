"use client";

import { Check, RotateCcw, Send } from "lucide-react";
import { useId, useState, useSyncExternalStore, type FormEvent } from "react";
import { useSession } from "@/components/app/session";
import { Button, ButtonLink } from "@/components/ui/button";
import { sendBugReport } from "@/lib/api";
import { BUG_REPORT_LIMITS } from "@/lib/bug-reports";

const noSubscribe = () => () => {};
/** The browser string the server records from the request; empty while rendering on the server. */
const useUserAgent = () => useSyncExternalStore(noSubscribe, () => navigator.userAgent, () => "");

const AREA = "field h-auto min-h-28 resize-y py-3 leading-relaxed";

/** `page` is the cleaned path the person came from (see reportPage), shown so they know what's sent. */
export function BugReportForm({ page }: { page: string }) {
  const id = useId();
  const session = useSession();
  const userAgent = useUserAgent();
  const [summary, setSummary] = useState("");
  const [expected, setExpected] = useState("");
  const [steps, setSteps] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending) return;
    if (!summary.trim()) {
      setError("Describe what went wrong.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendBugReport({ summary, expected, steps, page });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send your report. Try again.");
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setSummary("");
    setExpected("");
    setSteps("");
    setSent(false);
  }

  if (sent) {
    // A masked share link (/s/:token) is not a real page to go back to.
    const back = page.includes(":token") ? "" : page;
    return (
      <div role="status" className="flex max-w-[560px] flex-col gap-5">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-field">
            <Check aria-hidden className="size-5" />
          </span>
          <p className="text-lg font-semibold tracking-[-0.02em]">Thanks, your report was sent.</p>
        </div>
        <p className="text-sm text-muted">It goes to the person who builds VASH and is used only to find and fix the problem.</p>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href={back || "/home"}>{back ? "Back to where you were" : "Go to Home"}</ButtonLink>
          <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={reset}>
            Report another bug
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-[560px] flex-col gap-6">
      <label htmlFor={`${id}-summary`} className="flex flex-col gap-2 text-[13px] font-medium">
        What went wrong?
        <textarea
          id={`${id}-summary`}
          className={AREA}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={BUG_REPORT_LIMITS.summaryChars}
          placeholder="For example: the Export button does nothing after I add a photo."
          aria-invalid={error && !summary.trim() ? true : undefined}
          required
        />
      </label>
      <label htmlFor={`${id}-expected`} className="flex flex-col gap-2 text-[13px] font-medium">
        <span>
          What did you expect instead? <span className="font-normal text-muted">Optional</span>
        </span>
        <textarea
          id={`${id}-expected`}
          className={AREA}
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          maxLength={BUG_REPORT_LIMITS.expectedChars}
        />
      </label>
      <label htmlFor={`${id}-steps`} className="flex flex-col gap-2 text-[13px] font-medium">
        <span>
          How can we make it happen again? <span className="font-normal text-muted">Optional</span>
        </span>
        <textarea
          id={`${id}-steps`}
          className={AREA}
          value={steps}
          onChange={(e) => setSteps(e.target.value)}
          maxLength={BUG_REPORT_LIMITS.stepsChars}
          placeholder={"1. Open a template\n2. Add a photo\n3. Click Export"}
        />
      </label>

      <section aria-labelledby={`${id}-extra`} className="flex flex-col gap-2 rounded-xl border-[.5px] border-line p-4 text-sm">
        <h2 id={`${id}-extra`} className="font-semibold">
          Sent with your report
        </h2>
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[90px_1fr]">
          {page && (
            <>
              <dt className="text-muted">Page</dt>
              <dd className="mb-1 break-all sm:mb-0">{page}</dd>
            </>
          )}
          <dt className="text-muted">Browser</dt>
          <dd className="mb-1 break-all sm:mb-0">{userAgent || "Your browser's name and version"}</dd>
          <dt className="text-muted">Account</dt>
          <dd>
            {session.status === "user"
              ? `${session.me.email}, so we can email you if we need more detail.`
              : "None. You're not signed in, so we can't reply to this report."}
          </dd>
        </dl>
        <p className="text-muted">Please don&apos;t include passwords or other private details.</p>
      </section>

      {error && (
        <p role="alert" className="text-sm text-(--danger)">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" icon={<Send className="size-4" />} loading={sending}>
          {sending ? "Sending…" : "Send report"}
        </Button>
      </div>
    </form>
  );
}
