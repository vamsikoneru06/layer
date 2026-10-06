"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { editedLabel } from "@/lib/designs";
import { byUpdated, localDesigns, type LocalDesign } from "@/lib/local-designs";
import { DesignThumb } from "./design-thumb";

/** Designs a guest made in this browser, newest first. `null` while loading. */
export function useLocalDesigns(limit?: number) {
  const [designs, setDesigns] = useState<LocalDesign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    localDesigns.list().then(
      (all) => setDesigns(all.sort(byUpdated).slice(0, limit)),
      (err: Error) => setError(err.message),
    );
  }, [limit]);
  /** Deletes at once; Undo puts the same design back. */
  async function remove(id: string) {
    const design = designs?.find((d) => d.id === id);
    if (!design) return;
    try {
      await localDesigns.delete(id);
    } catch (err) {
      return void toast({ message: (err as Error).message });
    }
    setDesigns((d) => d?.filter((x) => x.id !== id) ?? null);
    toast({
      message: `Deleted “${design.doc.meta.title}” from this browser`,
      action: {
        label: "Undo",
        onClick: () =>
          void localDesigns.put(design).then(
            () => setDesigns((d) => (d ? [...d, design].sort(byUpdated) : d)),
            (err: Error) => toast({ message: err.message }),
          ),
      },
    });
  }
  return { designs, error, remove };
}

export function LocalDesignsGrid({ designs, onDelete }: { designs: LocalDesign[]; onDelete: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {designs.map((d) => (
        <div key={d.id} className="group relative flex flex-col gap-2.5">
          <Link href={`/edit/${d.id}`} className="flex flex-col gap-2.5 rounded-[14px]">
            <DesignThumb
              width={d.doc.artboard.width}
              height={d.doc.artboard.height}
              box={{ width: 190, height: 150 }}
              className="h-[180px] transition-[transform,box-shadow] duration-200 ease-(--ease) group-hover:-translate-y-[3px] group-hover:shadow-[0_14px_30px_rgba(0,0,0,.12),inset_0_0_0_.5px_var(--line)]"
            />
            <span className="flex flex-col gap-0.5 px-0.5 pr-9">
              <span className="truncate text-sm font-medium">{d.doc.meta.title}</span>
              <span className="text-xs text-muted">{editedLabel(d.updatedAt)}</span>
            </span>
          </Link>
          <button
            type="button"
            aria-label={`Delete ${d.doc.meta.title} from this browser`}
            title="Delete from this browser"
            onClick={() => onDelete(d.id)}
            className="absolute right-0 bottom-0.5 flex size-8 items-center justify-center rounded-lg text-muted hover:bg-field hover:text-danger [&_svg]:size-4"
          >
            <Trash2 aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
