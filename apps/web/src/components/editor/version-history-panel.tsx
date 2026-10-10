"use client";

import { fontRequests, referencedImages, renderDoc, type Measure, type RenderOptions } from "@vash/engine";
import { parseDoc, type Doc } from "@vash/schema";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { getVersion, listVersions, type VersionItem } from "@/lib/api";
import { fitBox } from "@/lib/designs";
import { cn } from "@/lib/utils";
import { versionTimeLabel } from "@/lib/version-time";

/** A version's document once fetched and checked, or why it cannot be shown. */
type Preview = { status: "loading" } | { status: "ready"; doc: Doc } | { status: "invalid" } | { status: "error"; message: string };

/** The panel is 288px wide; the preview fills the space inside its padding. */
const PREVIEW_BOX = { width: 256, height: 340 };

const messageOf = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/** The document if it passes the schema, otherwise null (a damaged or newer-format version). */
function checkDoc(raw: unknown): Doc | null {
  try {
    const result = parseDoc(raw);
    return result.ok ? result.doc : null;
  } catch {
    return null;
  }
}

/** Earlier versions of the open design, newest first, with a preview and restore. Guests get a note instead. */
export function VersionHistoryPanel({
  designId,
  local,
  measure,
  image,
  onRestore,
  onClose,
}: {
  designId: string;
  /** A design kept in this browser; versions need an account. */
  local: boolean;
  /** The design's current version number. Not shown here; the caller uses it for conflicts. */
  currentVersion: number;
  measure: Measure;
  image: RenderOptions["image"];
  /** Restores the version and resolves when the design has changed. Rejects with a message to show. */
  onRestore: (versionId: string) => Promise<void>;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [now] = useState(() => new Date());
  const [versions, setVersions] = useState<VersionItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Focus the heading so a keyboard or screen-reader user lands in the panel.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    if (local) return;
    let live = true;
    listVersions(designId).then(
      (items) => {
        if (live) setVersions(items);
      },
      (err: unknown) => {
        if (live) setLoadError(messageOf(err, "Couldn’t load versions."));
      },
    );
    return () => {
      live = false;
    };
  }, [designId, local, attempt]);

  async function load(id: string) {
    setPreviews((p) => ({ ...p, [id]: { status: "loading" } }));
    try {
      const version = await getVersion(designId, id);
      const doc = checkDoc(version.doc);
      setPreviews((p) => ({ ...p, [id]: doc ? { status: "ready", doc } : { status: "invalid" } }));
    } catch (err) {
      setPreviews((p) => ({ ...p, [id]: { status: "error", message: messageOf(err, "This version couldn’t be loaded.") } }));
    }
  }

  function select(id: string) {
    setSelected(id);
    setRestoreError(null);
    if (!previews[id]) void load(id);
  }

  function retryList() {
    setLoadError(null);
    setVersions(null);
    setAttempt((a) => a + 1);
  }

  async function restore() {
    if (!selected) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      await onRestore(selected);
      setConfirming(false);
      // The restore kept a new version, so the list is read again.
      setVersions(null);
      setAttempt((a) => a + 1);
    } catch (err) {
      setRestoreError(messageOf(err, "Couldn’t restore this version. Try again."));
    } finally {
      setRestoring(false);
    }
  }

  const chosen = versions?.find((v) => v.id === selected) ?? null;

  function body() {
    if (local) return <p className="text-muted">Version history needs an account. Save to account to keep versions.</p>;
    if (loadError !== null) {
      return (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-danger">
            {loadError}
          </p>
          <Button variant="secondary" size="sm" onClick={retryList}>
            Retry
          </Button>
        </div>
      );
    }
    if (versions === null) return <p role="status" className="text-muted">Loading versions…</p>;
    if (versions.length === 0) {
      return <p className="text-muted">No earlier versions yet. Versions are kept as you work and each time you press Ctrl+S.</p>;
    }
    const entry = selected ? previews[selected] : undefined;
    return (
      <>
        <ul aria-label="Earlier versions" className="flex flex-col gap-1">
          {versions.map((v) => {
            const current = v.id === selected;
            return (
              <li key={v.id}>
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  onClick={() => select(v.id)}
                  className={cn("flex w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left hover:bg-field", current && "bg-field")}
                >
                  <span className="font-medium">{versionTimeLabel(v.createdAt, now)}</span>
                  <span className="truncate text-muted">{v.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {selected && chosen && (
          <section aria-label="Selected version" className="flex flex-col gap-3 border-t-[.5px] border-line pt-4">
            {entry?.status === "ready" ? (
              <>
                <VersionPreview key={selected} doc={entry.doc} label={versionTimeLabel(chosen.createdAt, now)} measure={measure} image={image} />
                <Button
                  variant="secondary"
                  onClick={() => {
                    setRestoreError(null);
                    setConfirming(true);
                  }}
                >
                  Restore this version
                </Button>
              </>
            ) : entry?.status === "invalid" ? (
              <p className="text-muted">This version can’t be shown.</p>
            ) : entry?.status === "error" ? (
              <div className="flex flex-col items-start gap-3">
                <p role="alert" className="text-danger">
                  {entry.message}
                </p>
                <Button variant="secondary" size="sm" onClick={() => void load(selected)}>
                  Try again
                </Button>
              </div>
            ) : (
              <p role="status" className="text-muted">
                Loading preview…
              </p>
            )}
          </section>
        )}
      </>
    );
  }

  return (
    <section aria-label="Version history" className="flex min-h-0 flex-1 flex-col text-[13px] text-text">
      <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
        <h2 ref={heading} tabIndex={-1} className="text-[17px] font-semibold tracking-[-0.01em] outline-none">
          Version history
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close version history"
          className="grid size-8 place-items-center rounded-lg text-muted hover:bg-field hover:text-text"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">{body()}</div>

      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Restore this version?">
        <p className="text-muted">Your current design is kept as a version, so you can switch back.</p>
        {restoreError && (
          <p role="alert" className="text-danger">
            {restoreError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button size="sm" loading={restoring} onClick={() => void restore()}>
            {restoring ? "Restoring…" : "Restore"}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

/** A version drawn by the engine's renderer, fitted to the panel with its background. */
function VersionPreview({ doc, label, measure, image }: { doc: Doc; label: string; measure: Measure; image: RenderOptions["image"] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = fitBox(doc.artboard.width, doc.artboard.height, PREVIEW_BOX.width, PREVIEW_BOX.height);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(size.width * dpr);
    el.height = Math.round(size.height * dpr);
    const s = (size.width / doc.artboard.width) * dpr;
    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, el.width, el.height);
      renderDoc(ctx, doc, [s, 0, 0, s, 0, 0], { measure, image, dpr }, { background: true });
    };
    draw();
    // Redraw once the document's fonts have loaded, so the text matches the editor.
    let live = true;
    void Promise.all(fontRequests(doc).map((f) => document.fonts.load(f).catch(() => []))).then(() => {
      if (live) draw();
    });
    // Photos load in the background: redraw for a few seconds until they have all arrived.
    const photos = referencedImages(doc);
    let tries = 0;
    const timer = window.setInterval(() => {
      const waiting = photos.some((id) => image(id) === "loading");
      draw();
      if (!waiting || ++tries >= 20) window.clearInterval(timer);
    }, 300);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [doc, measure, image, size.width, size.height]);

  return (
    <div className="flex justify-center">
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Preview of the version from ${label}`}
        className="rounded-[3px] shadow-[0_0_0_.5px_var(--line)]"
        style={{ width: size.width, height: size.height }}
      />
    </div>
  );
}
