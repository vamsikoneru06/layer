"use client";

import { adaptToSize } from "@vash/engine";
import { FORMATS, LIMITS, type Doc, type FormatKey } from "@vash/schema";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { createDesignFromDoc } from "@/lib/api";
import { localDesigns, newLocalDesign } from "@/lib/local-designs";
import { DocPreview } from "../templates/doc-preview";

const PREVIEW = { width: 240, height: 240 };

/** "Title (Instagram story)", cut to the title limit without splitting a surrogate pair. */
function titleFor(base: string, label: string): string {
  let title = `${base} (${label})`.slice(0, LIMITS.titleChars);
  if (/[\ud800-\udbff]$/.test(title)) title = title.slice(0, -1);
  return title;
}

/** Editor › File › Make other sizes: lays the design out at each other format and saves it as a new design. */
export function MakeSizesDialog({ open, onClose, doc, local }: { open: boolean; onClose: () => void; doc: Doc; local: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<FormatKey | null>(null);
  const others = (Object.keys(FORMATS) as Exclude<FormatKey, "custom">[]).filter((key) => key !== doc.meta.format);

  async function create(key: Exclude<FormatKey, "custom">) {
    if (busy) return;
    setBusy(key);
    try {
      const target = FORMATS[key];
      const laid = adaptToSize(doc, { width: target.width, height: target.height, format: key });
      const copy: Doc = { ...laid, id: crypto.randomUUID(), meta: { ...laid.meta, title: titleFor(doc.meta.title, target.label) } };
      let id: string;
      if (local) {
        const design = newLocalDesign(copy);
        await localDesigns.put(design);
        id = design.id;
      } else {
        ({ id } = await createDesignFromDoc(copy));
      }
      router.push(`/edit/${id}`);
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn’t make that size. Try again." });
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Make other sizes">
      <p className="text-sm text-muted">Each size opens as a new design. This one stays as it is. Check the layout before you keep it.</p>
      <ul className="grid grid-cols-2 gap-3">
        {others.map((key) => {
          const f = FORMATS[key];
          const laid = adaptToSize(doc, { width: f.width, height: f.height, format: key });
          return (
            <li key={key} className="flex flex-col gap-2">
              <div className="flex h-[150px] items-center justify-center overflow-hidden rounded-xl bg-field">
                <DocPreview doc={laid} box={PREVIEW} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium">{f.label}</span>
                <Button variant="secondary" size="sm" loading={busy === key} disabled={busy !== null && busy !== key} onClick={() => void create(key)}>
                  {busy === key ? "Making…" : "Make"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
