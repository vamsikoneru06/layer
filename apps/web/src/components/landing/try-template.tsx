"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getMe, getTemplate, listTemplates } from "@/lib/api";
import { openTemplate } from "@/lib/open-template";

/** Opens the top featured template (or the most used one) straight in the editor; no account needed. */
export function TryTemplate({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const [featured] = (await listTemplates({ sort: "featured", limit: 1 })).items;
      const pick = featured ?? (await listTemplates({ sort: "popular", limit: 1 })).items[0];
      if (!pick) throw new Error("No templates yet. Try again later.");
      const [template, me] = await Promise.all([getTemplate(pick.id), getMe()]);
      router.push(`/edit/${await openTemplate(template, me !== null)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t open a template. Try again.");
      setBusy(false);
    }
  }

  return (
    <span className={className}>
      <Button size="lg" className="px-[26px]" loading={busy} onClick={() => void open()}>
        Try a template
      </Button>
      {error && (
        <span role="alert" className="mt-2 block text-sm text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
