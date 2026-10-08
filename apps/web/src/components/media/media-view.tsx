"use client";

import { Images, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useSession } from "@/components/app/session";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { ApiError, deleteAsset, listPhotos, resolveAssets, uploadPhoto, UPLOAD_TYPES, type Photo } from "@/lib/api";
import { cn } from "@/lib/utils";

type Upload = { key: string; name: string; state: "uploading" | "done" | "failed"; message?: string };

const NO_STORAGE = "Photo uploads aren't set up on this server yet: it needs photo storage connected. Your other work isn't affected.";

function PhotoTile({ photo, url, onDelete }: { photo: Photo; url: string | undefined; onDelete: () => void }) {
  return (
    <div className="group relative aspect-square overflow-hidden rounded-[14px] bg-bg2">
      {url ? (
        <img src={url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        <div aria-hidden className="size-full animate-[shimmer_1.4s_ease-in-out_infinite] bg-field" />
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/55 to-transparent px-2.5 pt-6 pb-2 text-[12px] text-white">
        <span className="tabular-nums">{photo.width && photo.height ? `${photo.width} × ${photo.height}` : ""}</span>
        <button
          type="button"
          aria-label="Delete photo"
          onClick={onDelete}
          className="flex size-7 items-center justify-center rounded-lg bg-black/40 opacity-0 group-hover:opacity-100 hover:bg-black/60 focus-visible:opacity-100"
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function MediaView() {
  const session = useSession();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [noStorage, setNoStorage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState<Photo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const signedIn = session.status === "user";

  async function showUrls(list: Photo[]) {
    if (list.length === 0) return;
    try {
      const { assets } = await resolveAssets(list.map((p) => p.id));
      setUrls((prev) => ({ ...prev, ...Object.fromEntries(assets.map((a) => [a.id, a.url])) }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) setNoStorage(true);
    }
  }

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    listPhotos()
      .then((page) => {
        if (!live) return;
        setPhotos(page.items);
        setCursor(page.nextCursor);
        void showUrls(page.items);
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [signedIn]);

  async function loadMore() {
    if (!cursor) return;
    const page = await listPhotos(cursor);
    setPhotos((prev) => [...(prev ?? []), ...page.items]);
    setCursor(page.nextCursor);
    void showUrls(page.items);
  }

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (list.length === 0) return;
    const batch = list.map((f, i): Upload => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, state: "uploading" }));
    setUploads((prev) => [...batch, ...prev]);
    for (const [i, file] of list.entries()) {
      const key = batch[i]!.key;
      try {
        const photo = await uploadPhoto(file);
        setPhotos((prev) => [photo, ...(prev ?? [])]);
        void showUrls([photo]);
        setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, state: "done" } : u)));
      } catch (err) {
        if (err instanceof ApiError && err.status === 503) setNoStorage(true);
        const message = err instanceof Error ? err.message : "Upload failed.";
        setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, state: "failed", message } : u)));
      }
    }
  }

  async function remove(photo: Photo) {
    setDeleting(true);
    try {
      await deleteAsset(photo.id);
      setPhotos((prev) => prev?.filter((p) => p.id !== photo.id) ?? null);
      toast({ message: "Photo deleted." });
      setConfirm(null);
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't delete the photo." });
    } finally {
      setDeleting(false);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (signedIn) void upload(e.dataTransfer.files);
  };

  const uploadButton = (
    <Button onClick={() => input.current?.click()} icon={<Upload aria-hidden className="size-4" />}>
      Upload photos
    </Button>
  );

  return (
    <div
      className={cn("flex flex-col gap-6 rounded-[20px]", dragging && "outline-2 outline-offset-8 outline-text outline-dashed")}
      onDragOver={(e) => {
        if (!signedIn) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[clamp(30px,5vw,40px)] leading-[1.02] font-bold tracking-[-0.035em]">Media</h1>
        {signedIn && uploadButton}
        <input
          ref={input}
          type="file"
          accept={UPLOAD_TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {session.status === "loading" ? null : !signedIn ? (
        <EmptyState
          icon={<Images aria-hidden />}
          title="Your photos live here"
          body="Sign in to upload photos and use them in your designs. They stay private to your account."
          action={<ButtonLink href="/signin">Sign in</ButtonLink>}
        />
      ) : (
        <>
          {noStorage && (
            <p role="status" className="rounded-[14px] bg-bg2 px-4 py-3 text-sm text-muted">
              {NO_STORAGE}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {uploads.length > 0 && (
            <ul aria-label="Uploads" className="flex flex-col gap-1.5 text-sm">
              {uploads.slice(0, 8).map((u) => (
                <li key={u.key} className="flex items-center justify-between gap-3 rounded-lg bg-bg2 px-3 py-2">
                  <span className="truncate">{u.name}</span>
                  <span className={cn("flex-none text-[13px]", u.state === "failed" ? "text-danger" : "text-muted")}>
                    {u.state === "uploading" ? "Uploading…" : u.state === "done" ? "Uploaded" : u.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {photos === null && !error ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="aspect-square animate-[shimmer_1.4s_ease-in-out_infinite] rounded-[14px] bg-field" />
              ))}
            </div>
          ) : photos && photos.length === 0 ? (
            <EmptyState
              icon={<Images aria-hidden />}
              title="No photos yet"
              body="Upload JPEG, PNG or WebP photos up to 15 MB each, or drop them onto this page. They stay private to your account."
              action={uploadButton}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {photos?.map((p) => (
                <PhotoTile key={p.id} photo={p} url={urls[p.id]} onDelete={() => setConfirm(p)} />
              ))}
            </div>
          )}
          {cursor && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => void loadMore()}>
                Show more
              </Button>
            </div>
          )}
        </>
      )}

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} title="Delete this photo?">
        <p className="text-sm text-muted">This can&apos;t be undone. Designs that use it will show &ldquo;Photo unavailable&rdquo; where it was.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" loading={deleting} onClick={() => confirm && void remove(confirm)}>
            {deleting ? "Deleting…" : "Delete photo"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
