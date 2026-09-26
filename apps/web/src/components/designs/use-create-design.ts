"use client";

import type { FormatKey } from "@vash/schema";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/components/app/session";
import { useToast } from "@/components/ui/toast";
import { createDesign } from "@/lib/api";

/** Creates an empty design and opens it; guests are sent to sign in, since only accounts can save today. */
export function useCreateDesign() {
  const router = useRouter();
  const session = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function create(key: string, format: FormatKey, size?: { width: number; height: number }) {
    if (busy) return;
    if (session.status !== "user") return router.push("/signin");
    setBusy(key);
    try {
      const { id } = await createDesign(format, size);
      router.push(`/edit/${id}`);
    } catch (err) {
      toast({ message: (err as Error).message });
      setBusy(null);
    }
  }

  return { create, busy };
}
