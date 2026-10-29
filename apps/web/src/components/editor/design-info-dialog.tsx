"use client";

import type { Doc } from "@vash/schema";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { describeDesign } from "@/lib/design-info";

export function DesignInfoDialog({ open, onClose, doc, savedAt }: { open: boolean; onClose: () => void; doc: Doc; savedAt: string }) {
  return (
    <Dialog open={open} onClose={onClose} title="Design info">
      <dl className="flex flex-col gap-2.5 text-sm">
        {describeDesign(doc, savedAt).map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <dt className="text-muted">{row.label}</dt>
            <dd className="font-medium tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
