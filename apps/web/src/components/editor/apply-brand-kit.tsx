"use client";

import { planBrandKit, type EditMode, type EditorCore } from "@vash/engine";
import { Palette } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ApiError, getBrandKit } from "@/lib/api";

const layers = (n: number) => (n === 1 ? "1 layer" : `${n} layers`);

/** Design panel: restyles the whole design with the user's brand kit (Settings › Brand kit) as one undo step. */
export function ApplyBrandKit({ core, mode }: { core: EditorCore; mode: EditMode }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const kit = await getBrandKit();
      if (kit.colors.length === 0 && kit.fonts.length === 0) {
        toast({ message: "Your brand kit is empty. Add colours or fonts in Settings first." });
        return;
      }
      const plan = planBrandKit(core.doc, kit, mode);
      const locked = plan.skippedLocked ? ` ${layers(plan.skippedLocked)} locked by the template kept ${plan.skippedLocked === 1 ? "its" : "their"} style.` : "";
      if (!plan.command) {
        toast({ message: plan.skippedLocked ? `Nothing to change.${locked}` : "This design already uses your brand kit." });
        return;
      }
      core.dispatch(plan.command);
      const what = plan.background ? (plan.changed ? `the background and ${layers(plan.changed)}` : "the background") : layers(plan.changed);
      toast({ message: `Restyled ${what} with your brand kit.${locked} Undo to go back.` });
    } catch (err) {
      toast({ message: err instanceof ApiError && err.status === 401 ? "Sign in to use a brand kit." : err instanceof Error ? err.message : "Couldn’t apply the brand kit." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" size="sm" icon={<Palette aria-hidden className="size-4" />} loading={busy} onClick={() => void run()}>
      {busy ? "Applying…" : "Apply brand kit"}
    </Button>
  );
}
