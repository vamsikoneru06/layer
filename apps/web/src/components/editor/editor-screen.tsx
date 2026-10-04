"use client";

import { parseDoc } from "@vash/schema";
import { FileQuestion, LockKeyhole, Monitor } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ApiError, getDesign, type Design } from "@/lib/api";
import { Workspace } from "./workspace";

type Load = { status: "loading" } | { status: "ready"; design: Design } | { status: "missing" } | { status: "signed-out" } | { status: "error"; message: string };

const WIDE = "(min-width: 1024px)";
const subscribeWide = (cb: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-svh items-center justify-center bg-bg p-6 text-text">{children}</main>;
}

export function EditorScreen({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => true);

  useEffect(() => {
    let live = true;
    getDesign(id).then(
      (design) => {
        // The same validator the server runs; never hand the engine a malformed document.
        const parsed = parseDoc(design.doc, { kind: "design" });
        if (!live) return;
        setLoad(parsed.ok ? { status: "ready", design: { ...design, doc: parsed.doc } } : { status: "error", message: "This design couldn’t be opened." });
      },
      (err: Error) => {
        if (!live) return;
        const status = err instanceof ApiError ? err.status : 0;
        setLoad(status === 404 ? { status: "missing" } : status === 401 ? { status: "signed-out" } : { status: "error", message: err.message });
      },
    );
    return () => {
      live = false;
    };
  }, [id]);

  // Below the breakpoint Workspace stays mounted but hidden, so the document, history and autosaver
  // survive a resize; remounting it would reopen the design as first loaded.
  return (
    <>
      {!wide && (
        <Centered>
          <EmptyState
            icon={<Monitor />}
            title="VASH’s editor needs a bigger screen."
            body="Your design is saved. Open it on a laptop or desktop to keep editing."
            action={<ButtonLink href="/designs" variant="secondary">Back to designs</ButtonLink>}
          />
        </Centered>
      )}
      <div className={wide ? "contents" : "hidden"}>
        <Screen load={load} />
      </div>
    </>
  );
}

function Screen({ load }: { load: Load }) {
  switch (load.status) {
    case "loading":
      return (
        <main className="flex h-svh flex-col bg-bg" aria-busy="true" aria-label="Loading the editor">
          <div className="h-14 border-b-[.5px] border-line" />
          <div className="flex flex-1">
            <div className="flex flex-1 items-center justify-center bg-bg2">
              <div className="aspect-square w-[min(60vh,50vw)] animate-[shimmer_1.4s_ease-in-out_infinite] rounded-sm bg-bg" />
            </div>
            <div className="w-[300px] border-l-[.5px] border-line" />
          </div>
        </main>
      );
    case "missing":
      return (
        <Centered>
          <EmptyState icon={<FileQuestion />} title="This design isn’t available" body="It may have been deleted, or it belongs to another account." action={<ButtonLink href="/designs">Your designs</ButtonLink>} />
        </Centered>
      );
    case "signed-out":
      return (
        <Centered>
          <EmptyState icon={<LockKeyhole />} title="Sign in to open this design" body="Designs saved to an account open only for that account." action={<ButtonLink href="/signin">Sign in</ButtonLink>} />
        </Centered>
      );
    case "error":
      return (
        <Centered>
          <EmptyState icon={<FileQuestion />} title="Something went wrong" body={load.message} action={<ButtonLink href="/designs" variant="secondary">Back to designs</ButtonLink>} />
        </Centered>
      );
    case "ready":
      return <Workspace design={load.design} />;
  }
}
