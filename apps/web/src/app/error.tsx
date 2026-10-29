"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusScreen } from "@/components/ui/status-screen";
import { reportClientError } from "@/lib/monitoring/client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportClientError(error), [error]);
  return (
    <StatusScreen
      icon={<TriangleAlert />}
      title="Something went wrong"
      body={
        <>
          <p>This page hit an error. Try again, or reload the page if it keeps happening.</p>
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
    </StatusScreen>
  );
}
