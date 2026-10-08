"use client";

import type { Doc, FormatKey } from "@vash/schema";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { otherSizes, planSet, type SetMember } from "@/lib/make-set";

/** What to make the set from: the title shows at once, the document loads when the dialog opens. */
export type SetSource = { title: string; load: () => Promise<Doc> };

/**
 * "Make other sizes": the design as a post, story, thumbnail, poster or invitation, each a new design.
 * Each size says how many text layers come out too small to read, so the person knows what to check.
 */
export function MakeSetDialog({
  source,
  onClose,
  save,
}: {
  source: SetSource | null;
  onClose: () => void;
  /** Saves the new designs; resolves to the sizes that couldn't be saved (empty when all were). */
  save: (members: SetMember[]) => Promise<FormatKey[]>;
}) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<FormatKey>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!source) return;
    let live = true;
    setDoc(null);
    setError(null);
    setBusy(false);
    source.load().then(
      (d) => {
        if (!live) return;
        setDoc(d);
        setChosen(new Set(otherSizes(d).map((s) => s.format)));
      },
      (err: Error) => live && setError(err.message),
    );
    return () => {
      live = false;
    };
  }, [source]);

  // Every size is planned up front, so each row can say what to check before anything is saved.
  const plan = useMemo(() => (doc ? planSet(doc, otherSizes(doc).map((s) => s.format)) : []), [doc]);
  const sizes = doc ? otherSizes(doc) : [];
  const picked = plan.filter((m) => chosen.has(m.format));

  async function make() {
    setBusy(true);
    setError(null);
    const failed = await save(picked);
    if (failed.length === 0) return onClose();
    // Only what failed stays ticked, so trying again doesn't make the saved ones twice.
    setChosen(new Set(failed));
    setError(`${failed.length} couldn’t be saved. Try again.`);
    setBusy(false);
  }

  const toggle = (f: FormatKey) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  return (
    <Dialog open={source !== null} onClose={onClose} title="Make other sizes">
      <p className="text-sm text-muted">
        Each size becomes a new design next to “{source?.title}”. The original stays as it is.
      </p>
      {!doc && !error && <div className="h-40 animate-[shimmer_1.4s_ease-in-out_infinite] rounded-xl bg-field" aria-busy="true" />}
      {doc && (
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">Sizes</legend>
          {sizes.map((s) => {
            const small = plan.find((m) => m.format === s.format)?.warnings.length ?? 0;
            return (
              <label key={s.format} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-field">
                <input type="checkbox" checked={chosen.has(s.format)} onChange={() => toggle(s.format)} className="size-4 flex-none accent-(--text)" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">{s.label}</span>
                  <span className="text-[13px] text-muted">
                    {s.width} × {s.height}
                    {small > 0 && ` · ${small} text ${small === 1 ? "layer" : "layers"} will be small, check ${small === 1 ? "it" : "them"}`}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => void make()} loading={busy} disabled={!doc || picked.length === 0}>
          {picked.length === 1 ? "Make 1 design" : `Make ${picked.length} designs`}
        </Button>
      </div>
    </Dialog>
  );
}
