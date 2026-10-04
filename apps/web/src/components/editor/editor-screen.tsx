"use client";

import { parseDoc } from "@vash/schema";
import { FileQuestion, LockKeyhole, Monitor } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ApiError, getDesign, type Design } from "@/lib/api";
import { localDesigns } from "@/lib/local-designs";
import { Workspace } from "./workspace";

type Load = { status: "loading" } | { status: "ready"; design: Design; local: boolean } | { status: "missing" } | { status: "signed-out" } | { status: "error"; message: string };

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
    // The same validator the server runs; never hand the engine a malformed document.
    const open = (design: Design, local: boolean) => {
      const parsed = parseDoc(design.doc, { kind: "design" });
      if (!live) return;
      setLoad(parsed.ok ? { status: "ready", design: { ...design, doc: parsed.doc }, local } : { status: "error", message: "This design couldn’t be opened." });
    };
    // Designs made without an account are on this device; everything else comes from the account.
    localDesigns
      .get(id)
      .catch(() => undefined)
      .then((local) => {
        if (local) return open({ id, title: local.doc.meta.title, version: local.version, folderId: null, doc: local.doc, updatedAt: local.updatedAt }, true);
        return getDesign(id).then(
          (design) => open(design, false),
          (err: Error) => {
            if (!live) return;
            const status = err instanceof ApiError ? err.status : 0;
            setLoad(status === 404 ? { status: "missing" } : status === 401 ? { status: "signed-out" } : { status: "error", message: err.message });
          },
        );
      });
    return () => {
      live = false;
    };
  }, [id]);

  if (!wide) {
    return (
      <Centered>
        <EmptyState
          icon={<Monitor />}
          title="VASH’s editor needs a bigger screen."
          body={
            load.status === "ready" && load.local
              ? "Your design is saved in this browser. Sign in to move it to your account, then open it on a laptop or desktop."
              : "Your design is saved. Open it on a laptop or desktop to keep editing."
          }
          action={<ButtonLink href="/designs" variant="secondary">Back to designs</ButtonLink>}
        />
      </Centered>
    );
  }
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
      return <Workspace design={load.design} local={load.local} />;
  }
}
