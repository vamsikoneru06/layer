"use client";

import { Bug, RotateCcw, TriangleAlert } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusScreen } from "@/components/ui/status-screen";
import { reportClientError } from "@/lib/monitoring/client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname();
  useEffect(() => reportClientError(error), [error]);
  return (
    <StatusScreen
      icon={<TriangleAlert />}
      title="Something went wrong"
      body={
        <>
          <p>This page hit an error. Your saved designs are safe. Try again, and if it keeps happening, reload the page.</p>
          {error.digest ? <p className="mt-2 text-xs">Reference: {error.digest}</p> : null}
        </>
      }
    >
      <Button icon={<RotateCcw className="size-4" />} onClick={reset}>
        Try again
      </Button>
      <ButtonLink href="/" variant="secondary">
        Go to the home page
      </ButtonLink>
      <ButtonLink href={`/report-a-bug?from=${encodeURIComponent(pathname)}`} variant="secondary" icon={<Bug className="size-4" />}>
        Report a bug
      </ButtonLink>
    </StatusScreen>
  );
}
