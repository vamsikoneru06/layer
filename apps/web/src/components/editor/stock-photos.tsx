"use client";

import type { Editor } from "@vash/engine";
import { Search } from "lucide-react";
import { useState } from "react";
import { ApiError, importStockPhoto, searchStock, stockImageUrl, type StockPhoto } from "@/lib/api";
import { placePhotos, toAssetRef, PHOTOS_UPLOADED } from "./photo-actions";

/**
 * Pexels search. Picking a photo copies it into the user's photos (an ordinary upload, so quotas and
 * checks apply) and places it like any other. Each result credits its photographer, as Pexels asks.
 */
export function StockPhotos({ editor }: { editor: Editor | null }) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const [photos, setPhotos] = useState<StockPhoto[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState<"search" | number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(q: string, page: number) {
    setBusy("search");
    setError(null);
    try {
      const res = await searchStock(q, page);
      setPhotos((p) => (page === 1 ? res.photos : [...(p ?? []), ...res.photos]));
      setNext(res.nextPage);
      setSearched(q);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Photo search didn't answer. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function use(photo: StockPhoto) {
    if (!editor || busy !== null) return;
    setBusy(photo.id);
    setError(null);
    try {
      const ref = toAssetRef(await importStockPhoto(photo));
      window.dispatchEvent(new Event(PHOTOS_UPLOADED));
      if (ref) placePhotos(editor, [ref]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That photo couldn't be added. Try another one.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = query.trim();
          if (q) void search(q, 1);
        }}
        className="flex h-9 items-center gap-2 rounded-xl bg-field px-3 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-text"
      >
        <Search aria-hidden className="size-4 flex-none text-muted" />
        <input
          type="search"
          aria-label="Search free photos on Pexels"
          placeholder="Search Pexels"
          maxLength={100}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
      </form>
      <p className="text-[12px] text-muted">
        Free photos from{" "}
        <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer" className="text-text underline underline-offset-2">
          Pexels
        </a>
        . Click one to add it; it&apos;s saved to your photos.
      </p>
      {error && (
        <p role="alert" className="text-[12px] text-[#c2410c]">
          {error}
        </p>
      )}

      {busy === "search" && !photos ? (
        <div className="grid grid-cols-2 gap-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="aspect-square animate-pulse rounded-lg bg-field" />
          ))}
        </div>
      ) : photos && photos.length === 0 ? (
        <p className="rounded-xl bg-field p-3 text-[12px] text-muted">No photos found for &ldquo;{searched}&rdquo;. Try another word.</p>
      ) : (
        photos && (
          <ul className="grid grid-cols-2 gap-x-2 gap-y-3" aria-label={`Pexels photos for ${searched}`}>
            {photos.map((p) => (
              <li key={p.id} className="flex min-w-0 flex-col gap-1">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void use(p)}
                  aria-label={`Add photo by ${p.photographer}${p.alt ? `: ${p.alt}` : ""}`}
                  className="relative block aspect-square w-full overflow-hidden rounded-lg transition hover:opacity-85 active:scale-[.97] disabled:cursor-wait"
                  style={{ background: p.color }}
                >
                  <img src={stockImageUrl(p.thumb)} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
                  {busy === p.id && <span className="absolute inset-0 grid place-items-center bg-black/45 text-[12px] font-medium text-white">Adding…</span>}
                </button>
                <a href={p.photographerUrl} target="_blank" rel="noopener noreferrer" className="truncate text-[11px] text-muted hover:text-text hover:underline">
                  {p.photographer}
                </a>
              </li>
            ))}
          </ul>
        )
      )}
      {next && searched && (
        <button type="button" disabled={busy !== null} onClick={() => void search(searched, next)} className="self-start text-[13px] font-medium hover:underline disabled:opacity-45">
          Show more
        </button>
      )}
    </>
  );
}
