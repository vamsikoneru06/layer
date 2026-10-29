"use client";

import type { Editor } from "@vash/engine";
import { Upload } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, listPhotos, resolveAssets, UPLOAD_TYPES, type Photo } from "@/lib/api";
import { Segmented } from "./fields";
import { PHOTO_DRAG_TYPE, PHOTOS_UPLOADED, placePhotos, toAssetRef, uploadAll } from "./photo-actions";
import { StockPhotos } from "./stock-photos";

/**
 * The Photos panel: upload photos, then click one to put it in the selected frame (or the next empty
 * one), or drag it onto any frame. The frame tiles add an empty frame.
 */
export function PhotosPanel({ editor, frameTiles }: { editor: Editor | null; frameTiles: ReactNode }) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [source, setSource] = useState<"mine" | "pexels">("mine");
  const input = useRef<HTMLInputElement>(null);

  async function show(list: Photo[]) {
    if (list.length === 0) return;
    try {
      const { assets } = await resolveAssets(list.map((p) => p.id));
      setUrls((u) => ({ ...u, ...Object.fromEntries(assets.map((a) => [a.id, a.url])) }));
    } catch {
      // Thumbnails stay blank; the photos still work.
    }
  }

  async function load(next: string | null) {
    try {
      const page = await listPhotos(next);
      setPhotos((p) => [...(next ? (p ?? []) : []), ...page.items]);
      setCursor(page.nextCursor);
      void show(page.items);
    } catch (err) {
      setPhotos((p) => p ?? []);
      setErrors([err instanceof ApiError ? err.message : "Your photos couldn't be loaded."]);
    }
  }

  useEffect(() => {
    const reload = () => void load(null);
    reload();
    window.addEventListener(PHOTOS_UPLOADED, reload);
    return () => window.removeEventListener(PHOTOS_UPLOADED, reload);
  }, []);

  async function upload(files: File[]) {
    if (!editor || files.length === 0) return;
    setErrors([]);
    const result = await uploadAll(files, (done, total) => setProgress(done < total ? `Uploading ${done + 1} of ${total}…` : null));
    setErrors(result.errors);
    placePhotos(editor, result.photos);
  }

  const ready = (photos ?? []).filter((p) => toAssetRef(p));

  return (
    <>
      <h2 className="text-[15px] font-semibold">Photos</h2>
      <Segmented
        name="Photo source"
        value={source}
        options={[
          { value: "mine", label: "Your photos" },
          { value: "pexels", label: "Pexels" },
        ]}
        onChange={setSource}
      />
      {source === "pexels" ? (
        <StockPhotos editor={editor} />
      ) : (
        <>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={UPLOAD_TYPES.join(",")}
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={!editor || progress !== null}
          onClick={() => input.current?.click()}
          className="glass-btn glass-secondary flex h-9 items-center justify-center gap-2 rounded-xl text-[13px] font-medium disabled:opacity-60"
        >
          <Upload aria-hidden className="size-4" />
          <span className="glass-label">{progress ?? "Upload photos"}</span>
        </button>
        {errors.length > 0 && (
          <ul role="alert" className="flex flex-col gap-1 text-[12px] text-[#c2410c]">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <p className="text-[12px] text-muted">Click a photo to fill the selected frame, or the next empty one. Drag it onto any frame to put it there.</p>

        {photos === null ? (
          <div className="grid grid-cols-2 gap-2" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="aspect-square animate-pulse rounded-lg bg-field" />
            ))}
          </div>
        ) : ready.length === 0 ? (
          <p className="rounded-xl bg-field p-3 text-[12px] text-muted">No photos yet. Upload some, or drop files onto the design.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2" aria-label="Your photos">
            {ready.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  draggable
                  aria-label="Use this photo"
                  onDragStart={(e) => {
                    e.dataTransfer.setData(PHOTO_DRAG_TYPE, JSON.stringify(toAssetRef(p)));
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => editor && placePhotos(editor, [toAssetRef(p)!])}
                  className="block aspect-square w-full overflow-hidden rounded-lg bg-field transition hover:opacity-85 active:scale-[.97]"
                >
                  {urls[p.id] && <img src={urls[p.id]} alt="" draggable={false} className="size-full object-cover" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {cursor && (
          <button type="button" onClick={() => void load(cursor)} className="self-start text-[13px] font-medium hover:underline">
            Show more
          </button>
        )}

        </>
      )}

      <h3 className="pt-1 text-[13px] font-semibold">Empty frames</h3>
      {frameTiles}
    </>
  );
}
