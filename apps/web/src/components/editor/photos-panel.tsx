"use client";

import type { Editor } from "@vash/engine";
import { RotateCw, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, listPhotos, resolveAssets, UPLOAD_TYPES, type Photo } from "@/lib/api";
import { localPhotos } from "@/lib/local-photos";
import { PHOTO_DRAG_TYPE, PHOTOS_UPLOADED, placePhotos, toAssetRef, uploadAll, type UploadResult } from "./photo-actions";

/**
 * The Photos panel: upload photos, then click one to put it in the selected frame (or the next empty
 * one), or drag it onto any frame. The frame tiles add an empty frame. With `local` (a design kept in this
 * browser) the photos are the ones on this device, shown from their stored files.
 */
export function PhotosPanel({ editor, frameTiles, local = false }: { editor: Editor | null; frameTiles: ReactNode; local?: boolean }) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  // What the last upload couldn't do: files worth another try, and whether storage is full.
  const [failed, setFailed] = useState<Pick<UploadResult, "retry" | "full">>({ retry: [], full: false });
  const input = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  async function show(list: Photo[]) {
    if (list.length === 0) return;
    try {
      const { assets } = await resolveAssets(list.map((p) => p.id));
      setUrls((u) => ({ ...u, ...Object.fromEntries(assets.map((a) => [a.id, a.url])) }));
    } catch {
      // Thumbnails stay blank; the photos still work.
    }
  }

  async function loadLocal() {
    try {
      const list = (await localPhotos.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      objectUrls.current.forEach((u) => URL.revokeObjectURL(u));
      objectUrls.current = list.map((p) => URL.createObjectURL(p.blob));
      setUrls(Object.fromEntries(list.map((p, i) => [p.id, objectUrls.current[i]!])));
      setPhotos(list.map((p) => ({ id: p.id, kind: "photo", mime: p.mime, bytes: p.blob.size, width: p.width, height: p.height, createdAt: p.createdAt })));
    } catch (err) {
      setPhotos((p) => p ?? []);
      setErrors([err instanceof Error ? err.message : "Photos on this device couldn't be read."]);
    }
  }

  async function load(next: string | null) {
    if (local) return loadLocal();
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
    return () => {
      window.removeEventListener(PHOTOS_UPLOADED, reload);
      objectUrls.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  async function upload(files: File[]) {
    if (!editor || files.length === 0) return;
    setErrors([]);
    setFailed({ retry: [], full: false });
    const result = await uploadAll(files, (done, total) => setProgress(done < total ? `${local ? "Adding" : "Uploading"} ${done + 1} of ${total}…` : null), local);
    setErrors(result.errors);
    setFailed(result);
    placePhotos(editor, result.photos);
  }

  const ready = (photos ?? []).filter((p) => toAssetRef(p));

  return (
    <>
      <h2 className="text-[15px] font-semibold">Photos</h2>
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
        <span className="glass-label">{progress ?? (local ? "Add photos" : "Upload photos")}</span>
      </button>
      {errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-[12px] text-[#c2410c]">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {(failed.retry.length > 0 || failed.full) && progress === null && (
        <div className="flex gap-2">
          {failed.retry.length > 0 && (
            <button
              type="button"
              onClick={() => void upload(failed.retry)}
              className="glass-btn glass-secondary flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12px] font-medium"
            >
              <RotateCw aria-hidden className="size-3.5" />
              <span className="glass-label">{failed.retry.length > 1 ? `Try ${failed.retry.length} again` : "Try again"}</span>
            </button>
          )}
          {failed.full && (
            <Link href="/media" className="glass-btn glass-secondary flex h-8 items-center rounded-xl px-3 text-[12px] font-medium">
              <span className="glass-label">Manage photos</span>
            </Link>
          )}
        </div>
      )}
      <p className="text-[12px] text-muted">Click a photo to fill the selected frame, or the next empty one. Drag it onto any frame to put it there.</p>
      {local && <p className="text-[12px] text-muted">Photos stay on this device until you save the design to an account.</p>}

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

      <h3 className="pt-1 text-[13px] font-semibold">Empty frames</h3>
      {frameTiles}
    </>
  );
}
