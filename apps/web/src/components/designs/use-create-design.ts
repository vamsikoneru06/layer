"use client";

import type { FormatKey } from "@vash/schema";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/components/app/session";
import { useToast } from "@/components/ui/toast";
import { createDesign } from "@/lib/api";
import { blankDoc, localDesigns, newLocalDesign } from "@/lib/local-designs";

/** Creates an empty design and opens it: in the account when signed in, otherwise on this device. */
export function useCreateDesign() {
  const router = useRouter();
  const session = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function create(key: string, format: FormatKey, size?: { width: number; height: number }) {
    if (busy) return;
    if (session.status === "loading") return;
    setBusy(key);
    try {
      let id: string;
      if (session.status === "user") ({ id } = await createDesign(format, size));
      else {
        const design = newLocalDesign(blankDoc(format, size));
        await localDesigns.put(design);
        id = design.id;
      }
      router.push(`/edit/${id}`);
    } catch (err) {
      toast({ message: (err as Error).message });
      setBusy(null);
    }
  }

  return { create, busy };
}
