"use client";

import type { Doc } from "@vash/schema";
import { useRouter } from "next/navigation";
import { useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { createDesignFromDoc, getMe, saveDesign, uploadPhoto } from "@/lib/api";
import type { Autosaver } from "@/lib/autosave";
import { localDesigns, moveDesign } from "@/lib/local-designs";
import { forgetUnusedPhotos, localPhotos, saveWithUploadedPhotos, withUploadedPhotos } from "@/lib/local-photos";

/**
 * For a design kept in this browser: signed in, it moves the design to the account and reopens it there;
 * signed out, it goes to sign-in, after which Home moves every design on this device.
 */
export function SaveToAccount({ id, saver }: { id: string; saver: RefObject<Autosaver<Doc> | null> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Local saves take milliseconds; wait for the last edit to land before copying the design.
      const s = saver.current;
      for (let i = 0; s?.dirty && i < 20; i++) {
        await s.flush();
        if (s.dirty) await new Promise((r) => setTimeout(r, 50));
      }
      if (!(await getMe())) return router.push("/signin");
      const design = await localDesigns.get(id);
      if (!design) throw new Error("This design is no longer in this browser.");
      const { id: to, kept } = await moveDesign(localDesigns, design, withUploadedPhotos(createDesignFromDoc, uploadPhoto), saveWithUploadedPhotos(saveDesign, uploadPhoto));
      await forgetUnusedPhotos(localPhotos, (await localDesigns.list()).map((d) => d.doc)).catch(() => {});
      // Nothing left to write locally; a full load reopens the design.
      s?.reset(s.version);
      // A kept device copy is still here, so the page that opens says so once (workspace.tsx).
      window.location.replace(`/edit/${to}${kept ? "?notice=kept" : ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save to your account. Try again.");
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {error && (
        <span role="alert" className="max-w-[260px] truncate text-[13px] text-danger" title={error}>
          {error}
        </span>
      )}
      <Button variant="secondary" size="sm" loading={busy} onClick={() => void save()}>
        Save to account
      </Button>
    </span>
  );
}
