"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { StatusScreen } from "@/components/ui/status-screen";
import { reportClientError } from "@/lib/monitoring/client";
import "./globals.css";

/** Replaces the root layout when it fails, so it brings its own html and body. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportClientError(error), [error]);
  return (
    <html lang="en">
      <body>
        <StatusScreen
          icon={<TriangleAlert />}
          title="VASH couldn't load"
          body={
            <>
              <p>Something went wrong while loading the app. Your saved designs are safe. Try again in a moment.</p>
              {error.digest ? <p className="mt-2 text-xs">Reference: {error.digest}</p> : null}
            </>
          }
        >
          <Button onClick={reset}>Try again</Button>
        </StatusScreen>
      </body>
    </html>
  );
}
